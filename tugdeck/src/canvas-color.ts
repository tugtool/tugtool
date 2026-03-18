/**
 * canvas-color.ts — Compute the canvas background hex for built-in themes.
 *
 * Uses the palette engine (same source of truth as PostCSS and tug-palette.css)
 * to convert each theme's --tug-base-bg-canvas TugColor value to a hex string.
 * This feeds the Swift bridge so the native window background matches the
 * web content on cold start.
 *
 * Built-in theme canvas colors:
 *   brio    — indigo-violet I:2 T:5  (near-black dark canvas)   [D05]
 *   harmony — indigo-violet I:3 T:95 (near-white light canvas)  [D05]
 *
 * When the canvas color changes in tug-base.css or harmony.css, update the
 * TugColor params here to match.
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
  resolveHyphenatedHue,
} from "./components/tugways/palette-engine";

import type { ThemeName } from "./contexts/theme-provider";

// ---------------------------------------------------------------------------
// Canvas background TugColor params
//
// Mirrors the --tug-base-bg-canvas value in tug-base.css (brio) and
// harmony.css (harmony):
//   brio    (tug-base.css): --tug-color(indigo-violet, i: 2, t: 5)   [263.3°]
//   harmony (harmony.css):  --tug-color(indigo-violet, i: 3, t: 95)  [263.3°]
// [D05] Harmony canvas color is indigo-violet I:3 T:95
// ---------------------------------------------------------------------------

type TugColorParams = { hue: string; intensity: number; tone: number };

const CANVAS_COLORS: Record<ThemeName, TugColorParams> = {
  brio:    { hue: "indigo-violet", intensity: 2, tone: 5 },
  harmony: { hue: "indigo-violet", intensity: 3, tone: 95 },
};

/**
 * Compute the canvas background as a 6-digit hex string for the given theme.
 *
 * Uses the same TugColor → oklch → hex pipeline as the PostCSS plugin, ensuring
 * the native window color always matches the web content.
 */
export function canvasColorHex(theme: ThemeName): string {
  const { hue, intensity, tone } = CANVAS_COLORS[theme];

  // Resolve hue angle: handle bare names and hyphenated adjacency (A-B).
  let h: number;
  let primaryName: string;

  const hyphenIdx = hue.indexOf("-");
  if (hyphenIdx > 0) {
    const left = hue.slice(0, hyphenIdx);
    const right = hue.slice(hyphenIdx + 1);
    if (left in HUE_FAMILIES && right in HUE_FAMILIES) {
      h = resolveHyphenatedHue(left, right);
      primaryName = left;
    } else {
      h = HUE_FAMILIES[hue] ?? 0;
      primaryName = hue;
    }
  } else {
    h = HUE_FAMILIES[hue] ?? 0;
    primaryName = hue;
  }

  const canonicalL = DEFAULT_CANONICAL_L[primaryName] ?? 0.77;
  const peakC = (primaryName in MAX_CHROMA_FOR_HUE
    ? MAX_CHROMA_FOR_HUE[primaryName]
    : findMaxChroma(canonicalL, h)) * PEAK_C_SCALE;

  const L = L_DARK
    + Math.min(tone, 50) * (canonicalL - L_DARK) / 50
    + Math.max(tone - 50, 0) * (L_LIGHT - canonicalL) / 50;
  const C = (intensity / 100) * peakC;

  return oklchToHex(L, C, h);
}
