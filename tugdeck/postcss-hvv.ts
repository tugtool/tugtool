/**
 * postcss-hvv — PostCSS plugin for --hvv() color notation expansion.
 *
 * Expands `--hvv(hue, vibrancy, value)` calls in CSS declaration values to
 * concrete `oklch(L C h)` strings at build time. Zero runtime cost; all
 * computation happens during the Vite/PostCSS build pipeline.
 *
 * Syntax:
 *   --hvv( <hue> , <vibrancy> , <value> )
 *
 *   <hue>      := <hue-name> | <number>
 *   <hue-name> := cherry | red | tomato | flame | orange | amber | gold | yellow
 *                | lime | green | mint | teal | cyan | sky | blue | cobalt
 *                | violet | purple | plum | pink | rose | magenta | berry | coral
 *   <vibrancy> := <number>   // 0–100
 *   <value>    := <number>   // 0–100
 *
 * Named hue examples:
 *   --hvv(blue, 5, 13)    → oklch(0.3115 0.0143 230)
 *   --hvv(cobalt, 3, 18)  → oklch(0.3727 0.0081 250)
 *
 * Raw angle example:
 *   --hvv(237, 5, 13)     → uses findMaxChroma() at canonicalL=0.77
 *
 * Multiple calls in a single declaration are all expanded.
 * Values without --hvv() are passed through unchanged.
 *
 * Import path: use explicit relative path from vite.config.ts (no @/ alias
 * in Node/Bun PostCSS context). Bun's native TS support handles .ts imports.
 *
 * @module postcss-hvv
 */

import type { Plugin } from "postcss";
import {
  HUE_FAMILIES,
  DEFAULT_CANONICAL_L,
  MAX_CHROMA_FOR_HUE,
  PEAK_C_SCALE,
  L_DARK,
  L_LIGHT,
  findMaxChroma,
} from "./src/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default canonical L used for raw numeric hue angles.
 * Chosen as the median of DEFAULT_CANONICAL_L values across all 24 hue
 * families (range: 0.619–0.901).
 */
const RAW_ANGLE_CANONICAL_L = 0.77;

// ---------------------------------------------------------------------------
// HVV regex
// ---------------------------------------------------------------------------

/**
 * Matches a single --hvv() call.
 * Group 1: hue (named word or raw decimal number)
 * Group 2: vibrancy (decimal number)
 * Group 3: value (decimal number)
 *
 * The `g` flag allows replaceAll-style iteration over multiple calls in one
 * declaration value.
 */
const HVV_PATTERN = /--hvv\(\s*([a-z]+|\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)/g;

// ---------------------------------------------------------------------------
// Formatting helper (matches hvvColor() precision convention)
// ---------------------------------------------------------------------------

/** Format a number to 4 decimal places with trailing zeros stripped. */
function fmt(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}

// ---------------------------------------------------------------------------
// Core expansion logic
// ---------------------------------------------------------------------------

/**
 * Expand a single --hvv(hue, vib, val) call to an oklch() string.
 *
 * For named hues: uses DEFAULT_CANONICAL_L[hue] and MAX_CHROMA_FOR_HUE[hue].
 * For raw numeric angles: uses RAW_ANGLE_CANONICAL_L and findMaxChroma().
 *
 * L formula (piecewise, matching hvvColor()):
 *   L = L_DARK + min(val, 50) * (canonicalL - L_DARK) / 50
 *             + max(val - 50, 0) * (L_LIGHT - canonicalL) / 50
 *
 * C formula (linear):
 *   C = (vib / 100) * peakC   where peakC = maxChroma * PEAK_C_SCALE
 */
function expandHvv(hueArg: string, vibArg: string, valArg: string): string {
  const vib = parseFloat(vibArg);
  const val = parseFloat(valArg);

  let h: number;
  let canonicalL: number;
  let peakC: number;

  const namedAngle = HUE_FAMILIES[hueArg];
  if (namedAngle !== undefined) {
    // Named hue path
    h = namedAngle;
    canonicalL = DEFAULT_CANONICAL_L[hueArg] ?? RAW_ANGLE_CANONICAL_L;
    const maxC = MAX_CHROMA_FOR_HUE[hueArg] ?? 0.022;
    peakC = maxC * PEAK_C_SCALE;
  } else {
    // Raw numeric angle path
    h = parseFloat(hueArg);
    canonicalL = RAW_ANGLE_CANONICAL_L;
    peakC = findMaxChroma(canonicalL, h) * PEAK_C_SCALE;
  }

  // val → L: piecewise formula (matches hvvColor() exactly)
  const L =
    L_DARK +
    Math.min(val, 50) * (canonicalL - L_DARK) / 50 +
    Math.max(val - 50, 0) * (L_LIGHT - canonicalL) / 50;

  // vib → C: linear
  const C = (vib / 100) * peakC;

  return `oklch(${fmt(L)} ${fmt(C)} ${h})`;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * PostCSS plugin factory that expands `--hvv()` notation to `oklch()` values.
 *
 * Usage in vite.config.ts:
 *   import postcssHvv from "./postcss-hvv";
 *   // ...
 *   css: { postcss: { plugins: [postcssHvv()] } }
 *
 * @returns A PostCSS Plugin object.
 */
export default function postcssHvv(): Plugin {
  return {
    postcssPlugin: "postcss-hvv",
    Declaration(decl) {
      if (!decl.value.includes("--hvv(")) return;
      decl.value = decl.value.replace(
        HVV_PATTERN,
        (_match, hue, vib, val) => expandHvv(hue as string, vib as string, val as string),
      );
    },
  };
}

postcssHvv.postcss = true;
