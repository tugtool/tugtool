/**
 * canvas-color.ts — Compute the canvas background hex from theme surface params.
 *
 * Uses the palette engine (same source of truth as PostCSS and tug-palette.css)
 * to convert a theme's --tug-surface-global-primary-normal-canvas-rest TugColor value to a hex string.
 * This feeds the Swift bridge so the native window background matches the
 * web content on cold start.
 *
 * Canvas params come from ThemeOutput.formulas after running deriveTheme():
 *   - hue:       resolved from recipe.surface.canvas.hue via the surfaceCanvasHueSlot
 *   - tone:      themeOutput.formulas.surfaceCanvasTone
 *   - intensity: themeOutput.formulas.surfaceCanvasIntensity (the DERIVED value)
 *
 * [D08] Canvas color derived from theme JSON at runtime.
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Canvas color params derived from ThemeOutput.formulas. */
export type CanvasColorParams = { hue: string; tone: number; intensity: number };

// ---------------------------------------------------------------------------
// canvasColorHex
// ---------------------------------------------------------------------------

/**
 * Compute the canvas background as a 6-digit hex string from derived surface params.
 *
 * Uses the same TugColor → oklch → hex pipeline as the PostCSS plugin, ensuring
 * the native window color always matches the web content.
 *
 * Callers obtain params by running deriveTheme() and extracting:
 *   - hue:       recipe.surface.canvas.hue (resolved via formulas.surfaceCanvasHueSlot)
 *   - tone:      themeOutput.formulas.surfaceCanvasTone
 *   - intensity: themeOutput.formulas.surfaceCanvasIntensity (DERIVED, not raw JSON)
 *
 * [D08] Canvas color derived from theme JSON at runtime, Spec S04.
 */
export function canvasColorHex(params: CanvasColorParams): string {
  const { hue, intensity, tone } = params;

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
