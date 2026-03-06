/**
 * Theme Anchor Data — Tugways Phase 5d5b
 *
 * Provides research-informed default anchor sets for all three themes
 * (brio, bluenote, harmony) across all 24 hue families.
 *
 * Anchor design principles:
 * - Stop 0:   L=0.96 / C=0.01 for all hues/themes (near-white, near-neutral)
 * - Stop 50:  Per-hue canonical L from Table T01; C at ~75% of MAX_CHROMA_FOR_HUE cap.
 *             Brio (light theme) uses canonical L directly.
 *             Bluenote (dark theme) shifts L +0.05–0.07 and C at ~85% of cap for vivid mid-tones.
 *             Harmony (balanced theme) uses midpoint values between brio and bluenote.
 * - Stop 100: L=0.42 for all hues (equals DEFAULT_LC_PARAMS.lMin, the L used to derive
 *             MAX_CHROMA_FOR_HUE); C at 95% of the cap to leave a small safety margin.
 *             Bluenote/harmony apply the same 0.04 stop-100 L lift as stop-50.
 *
 * All C values are at or below MAX_CHROMA_FOR_HUE to guarantee sRGB gamut safety.
 * These are starting seeds for gallery tuning — final values are exported via the gallery tool.
 *
 * @module components/tugways/theme-anchors
 */

import { MAX_CHROMA_FOR_HUE } from "./palette-engine";
import type { ThemeAnchorData, ThemeHueAnchors } from "./palette-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp c to the hue's MAX_CHROMA_FOR_HUE cap. */
function cap(hue: string, c: number): number {
  return Math.min(c, MAX_CHROMA_FOR_HUE[hue] ?? 0.22);
}

/** Round to 3 decimal places. */
function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// BRIO anchors — light theme
//
// Stop 0:   L=0.96, C=0.01 (near-white, near-neutral) — same for all hues.
// Stop 50:  Table T01 canonical L; C at 75% of MAX_CHROMA_FOR_HUE.
// Stop 100: L=0.42 (matches the L value used to compute the cap table);
//           C at 95% of MAX_CHROMA_FOR_HUE for a safe dark-tone anchor.
// ---------------------------------------------------------------------------

const BRIO_STOP_50_L: Record<string, number> = {
  cherry:  0.62,
  red:     0.65,
  tomato:  0.67,
  flame:   0.70,
  orange:  0.73,
  amber:   0.78,
  gold:    0.83,
  yellow:  0.90,
  lime:    0.82,
  green:   0.68,
  mint:    0.72,
  teal:    0.65,
  cyan:    0.68,
  sky:     0.62,
  blue:    0.55,
  indigo:  0.50,
  violet:  0.55,
  purple:  0.55,
  plum:    0.58,
  pink:    0.68,
  rose:    0.65,
  magenta: 0.62,
  crimson: 0.60,
  coral:   0.68,
};

function buildBrioAnchors(): ThemeHueAnchors {
  const result: ThemeHueAnchors = {};
  for (const hue of Object.keys(BRIO_STOP_50_L)) {
    result[hue] = {
      anchors: [
        { stop: 0,   L: 0.96, C: 0.01 },
        { stop: 50,  L: BRIO_STOP_50_L[hue], C: cap(hue, r3(MAX_CHROMA_FOR_HUE[hue] * 0.75)) },
        { stop: 100, L: 0.42,                C: cap(hue, r3(MAX_CHROMA_FOR_HUE[hue] * 0.95)) },
      ],
    };
  }
  return result;
}

export const BRIO_ANCHORS: ThemeHueAnchors = buildBrioAnchors();

// ---------------------------------------------------------------------------
// BLUENOTE anchors — dark theme
//
// Stop 50:  Canonical L +0.06 (or +0.05 for high-L hues to stay ≤ 0.96);
//           C at 85% of MAX_CHROMA_FOR_HUE for more vivid mid-tones.
// Stop 100: L = 0.42 + 0.04 = 0.46; C at 95% cap (same safety margin as brio).
// ---------------------------------------------------------------------------

function bluenoteL50(hue: string): number {
  const base = BRIO_STOP_50_L[hue];
  // Use a smaller shift for already-high lightness hues (yellow, gold, lime)
  // so we don't overshoot 0.96.
  const shift = base >= 0.85 ? 0.05 : 0.06;
  return r3(Math.min(base + shift, 0.95));
}

function buildBluenoteAnchors(): ThemeHueAnchors {
  const result: ThemeHueAnchors = {};
  for (const hue of Object.keys(BRIO_STOP_50_L)) {
    result[hue] = {
      anchors: [
        { stop: 0,   L: 0.96, C: 0.01 },
        { stop: 50,  L: bluenoteL50(hue), C: cap(hue, r3(MAX_CHROMA_FOR_HUE[hue] * 0.85)) },
        { stop: 100, L: 0.46,             C: cap(hue, r3(MAX_CHROMA_FOR_HUE[hue] * 0.95)) },
      ],
    };
  }
  return result;
}

export const BLUENOTE_ANCHORS: ThemeHueAnchors = buildBluenoteAnchors();

// ---------------------------------------------------------------------------
// HARMONY anchors — balanced theme (midpoint between brio and bluenote)
// ---------------------------------------------------------------------------

function buildHarmonyAnchors(): ThemeHueAnchors {
  const result: ThemeHueAnchors = {};
  for (const hue of Object.keys(BRIO_ANCHORS)) {
    const brioAnchors = BRIO_ANCHORS[hue].anchors;
    const bluenoteAnchors = BLUENOTE_ANCHORS[hue].anchors;
    result[hue] = {
      anchors: brioAnchors.map((brioAnchor, i) => {
        const bluenoteAnchor = bluenoteAnchors[i];
        return {
          stop: brioAnchor.stop,
          L:    r3((brioAnchor.L + bluenoteAnchor.L) / 2),
          C:    r3((brioAnchor.C + bluenoteAnchor.C) / 2),
        };
      }),
    };
  }
  return result;
}

export const HARMONY_ANCHORS: ThemeHueAnchors = buildHarmonyAnchors();

// ---------------------------------------------------------------------------
// DEFAULT_ANCHOR_DATA — combined export
// ---------------------------------------------------------------------------

/**
 * Default anchor data for all three themes.
 *
 * These are research-informed starting seeds derived from Table T01.
 * Final production values are hand-tuned via the gallery anchor editor
 * and exported as JSON using the gallery export tool.
 */
export const DEFAULT_ANCHOR_DATA: ThemeAnchorData = {
  brio:     BRIO_ANCHORS,
  bluenote: BLUENOTE_ANCHORS,
  harmony:  HARMONY_ANCHORS,
};
