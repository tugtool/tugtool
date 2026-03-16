#!/usr/bin/env bun
/**
 * generate-tug-palette.ts
 *
 * Generates styles/tug-palette.css from the constants defined in palette-engine.ts.
 * The single source of truth for canonical L values is roadmap/tug-color-canonical.json,
 * which palette-engine.ts imports. Running this script keeps tug-palette.css in sync.
 *
 * Usage:
 *   bun run scripts/generate-tug-palette.ts
 *
 * Or via package.json:
 *   bun run generate:palette
 */

import path from "path";
import {
  HUE_FAMILIES,
  DEFAULT_CANONICAL_L,
  MAX_CHROMA_FOR_HUE,
  L_DARK,
  L_LIGHT,
  PEAK_C_SCALE,
  NAMED_GRAYS,
  ACHROMATIC_L_VALUES,
} from "../src/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round a number to at most `digits` significant decimal places, trimming trailing zeros. */
function fmt(n: number, digits = 3): string {
  return parseFloat(n.toFixed(digits)).toString();
}

// ---------------------------------------------------------------------------
// Ordered hue list (HUE_FAMILIES key order)
// ---------------------------------------------------------------------------
const HUE_ORDER = Object.keys(HUE_FAMILIES);

// ---------------------------------------------------------------------------
// Build CSS
// ---------------------------------------------------------------------------

const lines: string[] = [];

// File header
lines.push(`/* GENERATED FILE — do not edit. Source: palette-engine.ts */`);
lines.push(`/**`);
lines.push(` * tug-palette.css — TugColor Palette Engine (Pure CSS)`);
lines.push(` *`);
lines.push(` * TugColor color model: Color, Intensity, Tone — a perceptual coordinate system`);
lines.push(` * mapped to OKLCH. Each hue has three constants (h, canonical-l, peak-c).`);
lines.push(` * Intensity (0-100) controls chroma as a fraction of peak-c. Tone (0-100)`);
lines.push(` * controls lightness via a piecewise linear formula between three anchors:`);
lines.push(` *   tone=0  → L_DARK (${fmt(L_DARK)})`);
lines.push(` *   tone=50 → canonical-l (per-hue)`);
lines.push(` *   tone=100 → L_LIGHT (${fmt(L_LIGHT)})`);
lines.push(` *`);
lines.push(` * Piecewise formula (calc + clamp):`);
lines.push(` *   L = L_DARK`);
lines.push(` *       + clamp(0, tone, 50) * (canonical-l - L_DARK) / 50`);
lines.push(` *       + (clamp(50, tone, 100) - 50) * (L_LIGHT - canonical-l) / 50`);
lines.push(` *   C = intensity / 100 * peak-c`);
lines.push(` *`);
lines.push(` * Five convenience presets per hue (canonical, light, dark, intense, muted)`);
lines.push(` * are handled by the TugColor parser and postcss-tug-color plugin at build time.`);
lines.push(` * They are not stored as CSS variables in this file.`);
lines.push(` *`);
lines.push(` * Import order (in globals.css):`);
lines.push(` *   1. tug-palette.css   — palette variables (this file)`);
lines.push(` *   2. tug-base.css    — semantic tokens (reference palette vars)`);
lines.push(` *   3. theme/*.css       — theme overrides (can override per-hue constants)`);
lines.push(` *`);
lines.push(` * All variables are scoped to \`body\` to match tug-base.css cascade scope.`);
lines.push(` * Theme files can override individual --tug-{hue}-* constants to tune colors.`);
lines.push(` *`);
lines.push(` * Per-hue constant names:`);
lines.push(` *   --tug-{hue}-h            OKLCH hue angle (degrees) from HUE_FAMILIES`);
lines.push(` *   --tug-{hue}-canonical-l  Canonical lightness at intensity=50, tone=50`);
lines.push(` *   --tug-{hue}-peak-c       Peak chroma = MAX_CHROMA_FOR_HUE * PEAK_C_SCALE (${PEAK_C_SCALE})`);
lines.push(` *`);
lines.push(` * Global constants:`);
lines.push(` *   --tug-l-dark   Lightness at tone=0 (${fmt(L_DARK)})`);
lines.push(` *   --tug-l-light  Lightness at tone=100 (${fmt(L_LIGHT)})`);
lines.push(` */`);
lines.push(``);

// body block
lines.push(`body {`);

// Global lightness anchors
lines.push(`  /* -------------------------------------------------------------------------`);
lines.push(`   * Global lightness anchors`);
lines.push(`   * Source: L_DARK = ${fmt(L_DARK)}, L_LIGHT = ${fmt(L_LIGHT)} from palette-engine.ts`);
lines.push(`   * ------------------------------------------------------------------------- */`);
lines.push(`  --tug-l-dark: ${fmt(L_DARK)};`);
lines.push(`  --tug-l-light: ${fmt(L_LIGHT)};`);
lines.push(``);

// Per-hue constants (144 = 48 x 3)
lines.push(`  /* -------------------------------------------------------------------------`);
lines.push(`   * Per-hue constants (144 = 48 hues x 3)`);
lines.push(`   * Source: HUE_FAMILIES, DEFAULT_CANONICAL_L, MAX_CHROMA_FOR_HUE * PEAK_C_SCALE(${PEAK_C_SCALE})`);
lines.push(`   * ------------------------------------------------------------------------- */`);
lines.push(``);

for (const hue of HUE_ORDER) {
  const h = HUE_FAMILIES[hue];
  const canonL = DEFAULT_CANONICAL_L[hue];
  const maxC = MAX_CHROMA_FOR_HUE[hue];
  const peakC = maxC * PEAK_C_SCALE;

  lines.push(`  /* ${hue} — hue angle ${h} */`);
  lines.push(`  --tug-${hue}-h: ${h};`);
  lines.push(`  --tug-${hue}-canonical-l: ${fmt(canonL, 3)};`);
  lines.push(`  --tug-${hue}-peak-c: ${fmt(peakC, 3)};`);
  lines.push(``);
}

// Named gray ramp (9 descriptive names, paper through pitch) + black/white anchors.
// Endpoint variables --tug-gray-0 and --tug-gray-100 are dropped per [D05]; use
// --tug-black and --tug-white for the true endpoints.
//
// Name-to-tone mapping from NAMED_GRAYS (palette-engine.ts):
//   paper=10, linen=20, parchment=30, vellum=40, graphite=50,
//   carbon=60, charcoal=70, ink=80, pitch=90
//
// L values from ACHROMATIC_L_VALUES (pre-computed from piecewise formula).

// Emit names in tone order (ascending) using NAMED_GRAYS ordering.
const NAMED_GRAY_ORDER = Object.keys(NAMED_GRAYS); // paper … pitch in definition order

lines.push(`  /* -------------------------------------------------------------------------`);
lines.push(`   * Named gray ramp (9 descriptive names: paper through pitch)`);
lines.push(`   * C=0 for all named grays (achromatic). Fixed L values from ACHROMATIC_L_VALUES.`);
lines.push(`   * Endpoint variables --tug-gray-0 / --tug-gray-100 removed (see D05).`);
lines.push(`   * --tug-black and --tug-white are the true achromatic endpoints.`);
lines.push(`   * ------------------------------------------------------------------------- */`);

for (const name of NAMED_GRAY_ORDER) {
  const L = ACHROMATIC_L_VALUES[name];
  lines.push(`  --tug-gray-${name}: oklch(${fmt(L, 4)} 0 0);`);
}
lines.push(`  --tug-black: oklch(0 0 0);`);
lines.push(`  --tug-white: oklch(1 0 0);`);
lines.push(`}`);
lines.push(``);

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

const tugdeckDir = path.resolve(import.meta.dir, "..");
const outPath = path.join(tugdeckDir, "styles", "tug-palette.css");

await Bun.write(outPath, lines.join("\n"));
console.log(`[generate-tug-palette] wrote ${outPath}`);
