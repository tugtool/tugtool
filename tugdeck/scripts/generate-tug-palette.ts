#!/usr/bin/env bun
/**
 * generate-tug-palette.ts
 *
 * Generates styles/tug-palette.css from the constants defined in palette-engine.ts.
 * The single source of truth for canonical L values is roadmap/tug-cita-canonical.json,
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
  CITA_PRESETS,
  L_DARK,
  L_LIGHT,
  PEAK_C_SCALE,
} from "../src/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round a number to at most `digits` significant decimal places, trimming trailing zeros. */
function fmt(n: number, digits = 3): string {
  return parseFloat(n.toFixed(digits)).toString();
}

/** Build the preset formula for a given hue, intensity, and tone. */
function presetFormula(H: string, intensity: number, tone: number): string {
  const lPart = lightnessPart(H, tone);
  const cPart = `calc(${intensity} / 100 * var(--tug-${H}-peak-c))`;
  const hPart = `var(--tug-${H}-h)`;
  return `oklch(${lPart} ${cPart} ${hPart})`;
}

/**
 * Build the CSS lightness expression for a given tone.
 *
 * tone=50 (and intense/muted/canonical) resolves to var(--tug-H-canonical-l) directly
 * because clamp(0,50,50)=50 contributes the full (canonical-l - l-dark)/50 step
 * and clamp(50,50,100)-50=0. So L simplifies to l-dark + (canonical-l - l-dark) = canonical-l.
 *
 * For other tone values we emit the full piecewise calc()+clamp() formula.
 */
function lightnessPart(H: string, val: number): string {
  if (val === 50) {
    return `var(--tug-${H}-canonical-l)`;
  }
  return (
    `calc(var(--tug-l-dark)` +
    ` + clamp(0, ${val}, 50) * (var(--tug-${H}-canonical-l) - var(--tug-l-dark)) / 50` +
    ` + (clamp(50, ${val}, 100) - 50) * (var(--tug-l-light) - var(--tug-${H}-canonical-l)) / 50)`
  );
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
lines.push(` * tug-palette.css — CITA Palette Engine (Pure CSS)`);
lines.push(` *`);
lines.push(` * CITA color model: Color, Intensity, Tone — a perceptual coordinate system`);
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
lines.push(` * Five convenience presets per hue (120 = 24 hues x 5 presets):`);
lines.push(` *   canonical  intensity=50, tone=50   The crayon color — reference point`);
lines.push(` *   light      intensity=20, tone=85   Background-safe, airy`);
lines.push(` *   dark       intensity=50, tone=20   Contrast text, dark surfaces`);
lines.push(` *   intense    intensity=90, tone=50   Pops, draws attention`);
lines.push(` *   muted      intensity=20, tone=50   Subdued, secondary`);
lines.push(` *`);
lines.push(` * Import order (in globals.css):`);
lines.push(` *   1. tug-palette.css   — palette variables (this file)`);
lines.push(` *   2. tug-tokens.css    — semantic tokens (reference palette vars)`);
lines.push(` *   3. theme/*.css       — theme overrides (can override per-hue constants)`);
lines.push(` *`);
lines.push(` * All variables are scoped to \`body\` to match tug-tokens.css cascade scope.`);
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

// Per-hue constants (72 = 24 x 3)
lines.push(`  /* -------------------------------------------------------------------------`);
lines.push(`   * Per-hue constants (72 = 24 hues x 3)`);
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

// Chromatic preset formulas (120 = 24 x 5)
lines.push(`  /* -------------------------------------------------------------------------`);
lines.push(`   * Chromatic preset formulas (120 = 24 hues x 5 presets)`);
lines.push(`   *`);
lines.push(`   * Each preset uses literal intensity/tone numbers in the calc()+clamp() formula.`);
lines.push(`   * Five presets: canonical (intensity=50,tone=50), light (intensity=20,tone=85),`);
lines.push(`   *               dark (intensity=50,tone=20), intense (intensity=90,tone=50),`);
lines.push(`   *               muted (intensity=20,tone=50)`);
lines.push(`   *`);
lines.push(`   * Formula for L (piecewise via clamp):`);
lines.push(`   *   L = var(--tug-l-dark)`);
lines.push(`   *       + clamp(0, tone, 50) * (var(--tug-H-canonical-l) - var(--tug-l-dark)) / 50`);
lines.push(`   *       + (clamp(50, tone, 100) - 50) * (var(--tug-l-light) - var(--tug-H-canonical-l)) / 50`);
lines.push(`   * Formula for C (linear):`);
lines.push(`   *   C = intensity / 100 * var(--tug-H-peak-c)`);
lines.push(`   *`);
lines.push(`   * Canonical (tone=50): clamp(0,50,50)=50 and clamp(50,50,100)-50=0, so`);
lines.push(`   *   L = var(--tug-l-dark) + 50*(canonical-l - l-dark)/50 + 0 = canonical-l`);
lines.push(`   *   (simplified to just var(--tug-H-canonical-l) directly)`);
lines.push(`   * ------------------------------------------------------------------------- */`);
lines.push(``);

const { canonical, light, dark, intense, muted } = CITA_PRESETS;

for (const hue of HUE_ORDER) {
  lines.push(`  /* ${hue} */`);
  lines.push(`  --tug-${hue}: ${presetFormula(hue, canonical.intensity, canonical.tone)};`);
  lines.push(`  --tug-${hue}-light: ${presetFormula(hue, light.intensity, light.tone)};`);
  lines.push(`  --tug-${hue}-dark: ${presetFormula(hue, dark.intensity, dark.tone)};`);
  lines.push(`  --tug-${hue}-intense: ${presetFormula(hue, intense.intensity, intense.tone)};`);
  lines.push(`  --tug-${hue}-muted: ${presetFormula(hue, muted.intensity, muted.tone)};`);
  lines.push(``);
}

// Neutral ramp
lines.push(`  /* -------------------------------------------------------------------------`);
lines.push(`   * Neutral ramp (5 presets) and black/white anchors — static oklch() literals`);
lines.push(`   * C=0 for all neutrals (achromatic). L values derived from piecewise formula`);
lines.push(`   * with L_DARK=${fmt(L_DARK)}, L_LIGHT=${fmt(L_LIGHT)}, canonical-L=0.555, rounded to 3 decimals.`);
lines.push(`   *   tone=50: L = canonical-L = 0.555  (canonical, intense, muted — no chroma)`);
lines.push(`   *   tone=85: L = 0.555 + 35*(${fmt(L_LIGHT)}-0.555)/50 = 0.555 + 0.284 = 0.839  (light)`);
lines.push(`   *   tone=20: L = ${fmt(L_DARK)} + 20*(0.555-${fmt(L_DARK)})/50 = ${fmt(L_DARK)} + 0.162 = 0.312    (dark)`);
lines.push(`   * --tug-black and --tug-white are absolute anchors, independent of val->L.`);
lines.push(`   * ------------------------------------------------------------------------- */`);
lines.push(`  --tug-neutral: oklch(0.555 0 0);`);
lines.push(`  --tug-neutral-light: oklch(0.839 0 0);`);
lines.push(`  --tug-neutral-dark: oklch(0.312 0 0);`);
lines.push(`  --tug-neutral-intense: oklch(0.555 0 0);`);
lines.push(`  --tug-neutral-muted: oklch(0.555 0 0);`);
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
