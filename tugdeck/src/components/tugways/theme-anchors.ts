/**
 * Theme Anchor Data — Tugways Phase 5d5b
 *
 * Hand-tuned anchor values for all 24 hue families. A single tuning is shared
 * across all three built-in themes (brio, bluenote, harmony).
 *
 * Anchor design:
 * - Stop 0:   L=0.96, C=0.01 — near-white, near-neutral for all hues.
 * - Stop 50:  Per-hue L from gallery tuning; C pegged to MAX_CHROMA_FOR_HUE
 *             for maximum saturation. CSS oklch() handles gamut mapping.
 * - Stop 100: L=0.42 (DEFAULT_LC_PARAMS.lMin); C = MAX_CHROMA_FOR_HUE.
 *
 * @module components/tugways/theme-anchors
 */

import { MAX_CHROMA_FOR_HUE } from "./palette-engine";
import type { ThemeAnchorData, ThemeHueAnchors } from "./palette-engine";

// ---------------------------------------------------------------------------
// Tuned stop-50 lightness per hue (from gallery tuning)
// ---------------------------------------------------------------------------

const STOP_50_L: Record<string, number> = {
  cherry:  0.77,
  red:     0.79,
  tomato:  0.80,
  flame:   0.85,
  orange:  0.87,
  amber:   0.89,
  gold:    0.90,
  yellow:  0.94,
  lime:    0.91,
  green:   0.84,
  mint:    0.86,
  teal:    0.88,
  cyan:    0.87,
  sky:     0.90,
  blue:    0.86,
  indigo:  0.88,
  violet:  0.89,
  purple:  0.88,
  plum:    0.88,
  pink:    0.90,
  rose:    0.91,
  magenta: 0.92,
  crimson: 0.90,
  coral:   0.90,
};

// ---------------------------------------------------------------------------
// Build shared anchors (single tuning for all themes)
// ---------------------------------------------------------------------------

function buildSharedAnchors(): ThemeHueAnchors {
  const result: ThemeHueAnchors = {};
  for (const [hue, L50] of Object.entries(STOP_50_L)) {
    const maxC = MAX_CHROMA_FOR_HUE[hue] ?? 0.22;
    result[hue] = {
      anchors: [
        { stop: 0,   L: 0.96, C: 0.01 },
        { stop: 50,  L: L50,  C: maxC },
        { stop: 100, L: 0.42, C: maxC },
      ],
    };
  }
  return result;
}

const SHARED_ANCHORS: ThemeHueAnchors = buildSharedAnchors();

export const BRIO_ANCHORS: ThemeHueAnchors = SHARED_ANCHORS;
export const BLUENOTE_ANCHORS: ThemeHueAnchors = SHARED_ANCHORS;
export const HARMONY_ANCHORS: ThemeHueAnchors = SHARED_ANCHORS;

// ---------------------------------------------------------------------------
// DEFAULT_ANCHOR_DATA — combined export
// ---------------------------------------------------------------------------

/**
 * Default anchor data for all three themes.
 *
 * All themes share the same hand-tuned anchor values. Per-hue stop-50 C values
 * are clamped to MAX_CHROMA_FOR_HUE for sRGB gamut safety.
 */
export const DEFAULT_ANCHOR_DATA: ThemeAnchorData = {
  brio:     BRIO_ANCHORS,
  bluenote: BLUENOTE_ANCHORS,
  harmony:  HARMONY_ANCHORS,
};
