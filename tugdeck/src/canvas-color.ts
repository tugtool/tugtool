/**
 * canvas-color.ts — Compute the canvas background hex for each theme.
 *
 * Uses the palette engine (same source of truth as PostCSS and tug-palette.css)
 * to convert each theme's --tug-base-bg-canvas TugColor value to a hex string.
 * This feeds the Swift bridge so the native window background matches the
 * web content on cold start.
 *
 * When a theme's canvas color changes in its CSS file, update the TugColor params
 * here to match. There are only three themes — this is easy to keep in sync.
 */

import {
  HUE_FAMILIES,
  DEFAULT_CANONICAL_L,
  MAX_CHROMA_FOR_HUE,
  PEAK_C_SCALE,
  L_DARK,
  L_LIGHT,
  findMaxChroma,
  oklchToHex,
} from "./components/tugways/palette-engine";

import type { ThemeName } from "./contexts/theme-provider";

// ---------------------------------------------------------------------------
// Per-theme canvas background TugColor params
//
// These mirror the --tug-base-bg-canvas values in each theme's CSS file:
//   brio     (tug-base.css): --tug-color(violet-6, i: 2, t: 5)   [hue-264 → violet-6]
//   bluenote (bluenote.css):   --tug-color(blue+9, i: 5, t: 13)    [hue-239 → blue+9]
//   harmony  (harmony.css):    --tug-color(yellow, i: 7, t: 39)
// ---------------------------------------------------------------------------

type TugColorParams = { hue: string; offset: number; intensity: number; tone: number };

const CANVAS_COLORS: Record<ThemeName, TugColorParams> = {
  brio:     { hue: "violet", offset: -6, intensity: 2,  tone: 5 },
  bluenote: { hue: "blue",   offset: +9, intensity: 5,  tone: 13 },
  harmony:  { hue: "yellow", offset:  0, intensity: 7,  tone: 39 },
};

/**
 * Compute the canvas background as a 6-digit hex string for the given theme.
 *
 * Uses the same TugColor → oklch → hex pipeline as the PostCSS plugin, ensuring
 * the native window color always matches the web content.
 */
export function canvasColorHex(theme: ThemeName): string {
  const { hue, offset, intensity, tone } = CANVAS_COLORS[theme];

  const baseAngle = HUE_FAMILIES[hue];
  let h: number;
  let canonicalL: number;
  let peakC: number;

  if (baseAngle !== undefined) {
    if (offset === 0) {
      // Exact named hue
      h = baseAngle;
      canonicalL = DEFAULT_CANONICAL_L[hue] ?? 0.77;
      peakC = (MAX_CHROMA_FOR_HUE[hue] ?? 0.022) * PEAK_C_SCALE;
    } else {
      // Named hue with offset
      h = ((baseAngle + offset) % 360 + 360) % 360;
      canonicalL = DEFAULT_CANONICAL_L[hue] ?? 0.77;
      peakC = findMaxChroma(canonicalL, h) * PEAK_C_SCALE;
    }
  } else {
    h = 0;
    canonicalL = 0.77;
    peakC = findMaxChroma(canonicalL, h) * PEAK_C_SCALE;
  }

  const L = L_DARK
    + Math.min(tone, 50) * (canonicalL - L_DARK) / 50
    + Math.max(tone - 50, 0) * (L_LIGHT - canonicalL) / 50;
  const C = (intensity / 100) * peakC;

  return oklchToHex(L, C, h);
}
