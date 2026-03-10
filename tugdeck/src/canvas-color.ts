/**
 * canvas-color.ts — Compute the canvas background hex for each theme.
 *
 * Uses the palette engine (same source of truth as PostCSS and tug-palette.css)
 * to convert each theme's --tug-base-bg-canvas HVV value to a hex string.
 * This feeds the Swift bridge so the native window background matches the
 * web content on cold start.
 *
 * When a theme's canvas color changes in its CSS file, update the HVV params
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
// Per-theme canvas background HVV params
//
// These mirror the --tug-base-bg-canvas values in each theme's CSS file:
//   brio     (tug-tokens.css): --hvv(hue-264, 2, 5)
//   bluenote (bluenote.css):   --hvv(hue-239, 5, 13)
//   harmony  (harmony.css):    --hvv(yellow, 7, 39)
// ---------------------------------------------------------------------------

type HvvParams = { hue: string; vib: number; val: number };

const CANVAS_HVV: Record<ThemeName, HvvParams> = {
  brio:     { hue: "hue-264", vib: 2,  val: 5 },
  bluenote: { hue: "hue-239", vib: 5,  val: 13 },
  harmony:  { hue: "yellow",  vib: 7,  val: 39 },
};

/**
 * Compute the canvas background as a 6-digit hex string for the given theme.
 *
 * Uses the same HVV → oklch → hex pipeline as the PostCSS plugin, ensuring
 * the native window color always matches the web content.
 */
export function canvasColorHex(theme: ThemeName): string {
  const { hue, vib, val } = CANVAS_HVV[theme];

  let h: number;
  let canonicalL: number;
  let peakC: number;

  const namedAngle = HUE_FAMILIES[hue];
  if (namedAngle !== undefined) {
    h = namedAngle;
    canonicalL = DEFAULT_CANONICAL_L[hue] ?? 0.77;
    peakC = (MAX_CHROMA_FOR_HUE[hue] ?? 0.022) * PEAK_C_SCALE;
  } else if (hue.startsWith("hue-")) {
    h = parseFloat(hue.slice(4));
    canonicalL = 0.77;
    peakC = findMaxChroma(canonicalL, h) * PEAK_C_SCALE;
  } else {
    h = parseFloat(hue);
    canonicalL = 0.77;
    peakC = findMaxChroma(canonicalL, h) * PEAK_C_SCALE;
  }

  const L = L_DARK
    + Math.min(val, 50) * (canonicalL - L_DARK) / 50
    + Math.max(val - 50, 0) * (L_LIGHT - canonicalL) / 50;
  const C = (vib / 100) * peakC;

  return oklchToHex(L, C, h);
}
