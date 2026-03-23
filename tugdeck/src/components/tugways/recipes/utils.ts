/**
 * Recipe utilities — shared helpers for darkRecipe and lightRecipe.
 */

import { toneToL } from "../palette-engine";
import {
  CONTRAST_SCALE,
  POLARITY_FACTOR,
  CONTRAST_MIN_DELTA,
} from "../theme-accessibility";

/**
 * Compute perceptual contrast between element at elementL and surface at surfaceL.
 * Uses the same CONTRAST_SCALE (150) and POLARITY_FACTOR (0.85) as the engine.
 */
function contrastFromL(elementL: number, surfaceL: number): number {
  const deltaL = surfaceL - elementL;
  if (Math.abs(deltaL) < CONTRAST_MIN_DELTA) return 0;
  return deltaL > 0
    ? deltaL * CONTRAST_SCALE
    : deltaL * CONTRAST_SCALE * POLARITY_FACTOR;
}

/**
 * Binary-search in tone space (0-100) for a tone that achieves `threshold`
 * perceptual contrast against `surfaceTone`.
 *
 * Uses toneToL with the generic fallback (canonL=0.77) when hueName is omitted.
 * enforceContrastFloor in the engine provides hue-aware correction downstream,
 * so recipe-level results are approximate starting points that the safety net refines.
 *
 * @param surfaceTone - Surface tone (0-100)
 * @param threshold   - Required contrast magnitude (e.g. 75 for content role)
 * @param direction   - "lighter" | "darker" | "auto" (default "auto")
 *                      auto: dark surfaces (tone < 50) -> lighter; light surfaces -> darker
 * @param hueName     - Optional element hue name for more accurate L conversion
 * @returns Found tone, rounded to nearest integer, clamped to [0, 100]
 */
export function contrastSearch(
  surfaceTone: number,
  threshold: number,
  direction?: "lighter" | "darker" | "auto",
  hueName?: string,
): number {
  const resolvedDirection =
    direction === "lighter" || direction === "darker"
      ? direction
      : surfaceTone < 50
        ? "lighter"
        : "darker";

  const surfaceL = toneToL(surfaceTone);

  const extremeTone = resolvedDirection === "lighter" ? 100 : 0;
  const extremeL = toneToL(extremeTone, hueName);
  const extremeContrast = Math.abs(contrastFromL(extremeL, surfaceL));

  if (extremeContrast < threshold) {
    // Threshold unachievable — return extreme as best available
    return extremeTone;
  }

  // Binary search with 0.5 tone unit precision (20 iterations gives ~2^-20 range)
  let lo = resolvedDirection === "lighter" ? surfaceTone : 0;
  let hi = resolvedDirection === "lighter" ? 100 : surfaceTone;
  let result = extremeTone;

  for (let iter = 0; iter < 20; iter++) {
    const mid = (lo + hi) / 2;
    const midL = toneToL(mid, hueName);
    const midContrast = Math.abs(contrastFromL(midL, surfaceL));

    if (midContrast >= threshold) {
      result = mid;
      // Found passing — try to get closer to surface (less extreme)
      if (resolvedDirection === "lighter") {
        hi = mid;
      } else {
        lo = mid;
      }
    } else {
      // Not passing — push further from surface
      if (resolvedDirection === "lighter") {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    if (hi - lo < 0.5) break;
  }

  return Math.round(Math.max(0, Math.min(100, result)));
}
