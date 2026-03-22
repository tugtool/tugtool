/**
 * tug-color-strip.tsx — Tone and intensity gradient strip components.
 *
 * Provides two compact color picker strips that render CSS oklch() gradients:
 *
 *   TugToneStrip     — Gradient from dark (tone 0) to light (tone 100) at a
 *                      given hue and intensity. Click/drag to pick a tone.
 *
 *   TugIntensityStrip — Gradient from achromatic (intensity 0) to vivid
 *                       (intensity 100) at a given hue and tone. Click/drag to
 *                       pick an intensity.
 *
 * Both components fire onChange on every drag frame. The caller is responsible
 * for debouncing downstream effects (e.g., deriveTheme at 150 ms per L06).
 *
 * Rules of Tugways compliance:
 *   - Colors are set via inline style / CSS gradient, not React appearance state [L06]
 *   - Pointer capture used for drag: pointerdown captures, pointermove updates,
 *     pointerup releases — no global event listeners needed [D08]
 *
 * @module components/tugways/tug-color-strip
 */

import React, { useCallback, useRef } from "react";
import {
  HUE_FAMILIES,
  MAX_CHROMA_FOR_HUE,
  PEAK_C_SCALE,
  DEFAULT_CANONICAL_L,
  L_DARK,
  L_LIGHT,
} from "@/components/tugways/palette-engine";
import "./tug-color-strip.css";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Number of color stops in each gradient strip. */
const STOP_COUNT = 11;

/**
 * Format a number to 4 significant decimal places, stripping trailing zeros.
 * Matches the convention in tugColor().
 */
function fmt(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}

/**
 * Resolve a hue expression to an OKLCH hue angle.
 * Compound names like "indigo-violet" use the midpoint angle from HUE_FAMILIES
 * if the compound key exists, or fall back to the primary name's angle.
 */
function resolveHueAngle(hue: string): number {
  if (hue in HUE_FAMILIES) return HUE_FAMILIES[hue];
  const primary = hue.indexOf("-") > 0 ? hue.slice(0, hue.indexOf("-")) : hue;
  return HUE_FAMILIES[primary] ?? 0;
}

/**
 * Compute the OKLCH L value for a given tone and hue, using the same
 * piecewise formula as tugColor() and toneToL().
 */
function toneToLLocal(tone: number, canonicalL: number): number {
  return (
    L_DARK +
    (Math.min(tone, 50) * (canonicalL - L_DARK)) / 50 +
    (Math.max(tone - 50, 0) * (L_LIGHT - canonicalL)) / 50
  );
}

/**
 * Build a single oklch() CSS stop string.
 */
function oklchStop(L: number, C: number, angle: number): string {
  return `oklch(${fmt(L)} ${fmt(C)} ${angle})`;
}

/**
 * Build a CSS linear-gradient string for the tone strip.
 * Gradient runs left (tone=0, dark) to right (tone=100, light).
 */
function buildToneGradient(hue: string, intensity: number): string {
  const angle = resolveHueAngle(hue);
  const primary = hue.indexOf("-") > 0 ? hue.slice(0, hue.indexOf("-")) : hue;
  const canonL = DEFAULT_CANONICAL_L[primary] ?? DEFAULT_CANONICAL_L[hue] ?? 0.77;
  const maxC = MAX_CHROMA_FOR_HUE[primary] ?? MAX_CHROMA_FOR_HUE[hue] ?? 0.022;
  const peakC = maxC * PEAK_C_SCALE;
  const C = (intensity / 100) * peakC;

  const stops: string[] = [];
  for (let i = 0; i < STOP_COUNT; i++) {
    const tone = (i / (STOP_COUNT - 1)) * 100;
    const L = toneToLLocal(tone, canonL);
    stops.push(oklchStop(L, C, angle));
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/**
 * Build a CSS linear-gradient string for the intensity strip.
 * Gradient runs left (intensity=0, achromatic) to right (intensity=100, vivid).
 */
function buildIntensityGradient(hue: string, tone: number): string {
  const angle = resolveHueAngle(hue);
  const primary = hue.indexOf("-") > 0 ? hue.slice(0, hue.indexOf("-")) : hue;
  const canonL = DEFAULT_CANONICAL_L[primary] ?? DEFAULT_CANONICAL_L[hue] ?? 0.77;
  const maxC = MAX_CHROMA_FOR_HUE[primary] ?? MAX_CHROMA_FOR_HUE[hue] ?? 0.022;
  const peakC = maxC * PEAK_C_SCALE;
  const L = toneToLLocal(tone, canonL);

  const stops: string[] = [];
  for (let i = 0; i < STOP_COUNT; i++) {
    const intensity = (i / (STOP_COUNT - 1)) * 100;
    const C = (intensity / 100) * peakC;
    stops.push(oklchStop(L, C, angle));
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/**
 * Compute a 0-100 value from pointer X position relative to a strip element.
 */
function valueFromPointerX(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect();
  const ratio = (clientX - rect.left) / rect.width;
  return Math.round(Math.max(0, Math.min(100, ratio * 100)));
}

// ---------------------------------------------------------------------------
// TugToneStrip
// ---------------------------------------------------------------------------

export interface TugToneStripProps {
  /** Named hue: "blue", "indigo-violet", etc. */
  hue: string;
  /** Current intensity (0-100) — used to compute gradient chroma. */
  intensity: number;
  /** Current tone value (0-100). Controls thumb position. */
  value: number;
  /** Called with new tone value on click or drag. */
  onChange: (tone: number) => void;
  /** Optional data-testid for the strip container. */
  "data-testid"?: string;
}

/**
 * TugToneStrip — horizontal CSS oklch() gradient strip for picking tone.
 *
 * The gradient runs from dark (tone 0) on the left to light (tone 100) on
 * the right, at the given hue and intensity. A thumb indicator shows the
 * current value. Click or drag to set tone.
 */
export function TugToneStrip({
  hue,
  intensity,
  value,
  onChange,
  "data-testid": testId,
}: TugToneStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      if (stripRef.current) {
        onChange(valueFromPointerX(stripRef.current, e.clientX));
      }
    },
    [onChange],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      if (stripRef.current) {
        onChange(valueFromPointerX(stripRef.current, e.clientX));
      }
    },
    [onChange],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [],
  );

  const gradient = buildToneGradient(hue, intensity);
  const thumbPercent = value;

  return (
    <div
      ref={stripRef}
      className="tug-color-strip"
      style={{ background: gradient }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      data-testid={testId}
      data-gradient={gradient}
    >
      <div
        className="tug-color-strip__thumb"
        style={{ left: `${thumbPercent}%` }}
        data-testid={testId ? `${testId}-thumb` : undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TugIntensityStrip
// ---------------------------------------------------------------------------

export interface TugIntensityStripProps {
  /** Named hue: "blue", "indigo-violet", etc. */
  hue: string;
  /** Current tone (0-100) — used to compute gradient lightness. */
  tone: number;
  /** Current intensity value (0-100). Controls thumb position. */
  value: number;
  /** Called with new intensity value on click or drag. */
  onChange: (intensity: number) => void;
  /** Optional data-testid for the strip container. */
  "data-testid"?: string;
}

/**
 * TugIntensityStrip — horizontal CSS oklch() gradient strip for picking intensity.
 *
 * The gradient runs from achromatic (intensity 0) on the left to vivid
 * (intensity 100) on the right, at the given hue and tone. A thumb indicator
 * shows the current value. Click or drag to set intensity.
 */
export function TugIntensityStrip({
  hue,
  tone,
  value,
  onChange,
  "data-testid": testId,
}: TugIntensityStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      if (stripRef.current) {
        onChange(valueFromPointerX(stripRef.current, e.clientX));
      }
    },
    [onChange],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      if (stripRef.current) {
        onChange(valueFromPointerX(stripRef.current, e.clientX));
      }
    },
    [onChange],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [],
  );

  const gradient = buildIntensityGradient(hue, tone);
  const thumbPercent = value;

  return (
    <div
      ref={stripRef}
      className="tug-color-strip"
      style={{ background: gradient }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      data-testid={testId}
      data-gradient={gradient}
    >
      <div
        className="tug-color-strip__thumb"
        style={{ left: `${thumbPercent}%` }}
        data-testid={testId ? `${testId}-thumb` : undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported gradient builders (for testing)
// ---------------------------------------------------------------------------

export { buildToneGradient, buildIntensityGradient, valueFromPointerX };
