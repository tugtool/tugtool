/**
 * canvas-color.ts — Compute the canvas background hex for Brio.
 *
 * Uses the palette engine (same source of truth as PostCSS and tug-palette.css)
 * to convert Brio's --tug-base-bg-canvas TugColor value to a hex string.
 * This feeds the Swift bridge so the native window background matches the
 * web content on cold start.
 *
 * When the canvas color changes in tug-base.css, update the TugColor params
 * here to match.
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
// Canvas background TugColor params
//
// Mirrors the --tug-base-bg-canvas value in tug-base.css:
//   brio (tug-base.css): --tug-color(violet-6, i: 2, t: 5)   [hue-264 → violet-6]
// ---------------------------------------------------------------------------

type TugColorParams = { hue: string; offset: number; intensity: number; tone: number };

const CANVAS_COLORS: Record<ThemeName, TugColorParams> = {
  brio: { hue: "violet", offset: -6, intensity: 2, tone: 5 },
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
