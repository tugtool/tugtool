/**
 * postcss-hvv — PostCSS plugin for --hvv() color notation expansion.
 *
 * Expands `--hvv(hue, vibrancy, value)` calls in CSS declaration values to
 * concrete `oklch(L C h)` strings at build time. Zero runtime cost; all
 * computation happens during the Vite/PostCSS build pipeline.
 *
 * Syntax:
 *   --hvv( <hue> , <vibrancy> , <value> [, <alpha>] )
 *
 *   <hue>      := <hue-name> | <number> | hue-<number> | black | white
 *   <hue-name> := cherry | red | tomato | flame | orange | amber | gold | yellow
 *                | lime | green | mint | teal | cyan | sky | blue | cobalt
 *                | violet | purple | plum | pink | rose | magenta | berry | coral
 *   <vibrancy> := <number>   // 0–100
 *   <value>    := <number>   // 0–100
 *   <alpha>    := <number>   // 0–1 (optional, omitted means fully opaque)
 *
 * Special achromatic keywords:
 *   black — always expands to oklch(0 0 0), ignoring vibrancy/value
 *   white — always expands to oklch(1 0 0), ignoring vibrancy/value
 *
 * Named hue examples:
 *   --hvv(blue, 5, 13)          → oklch(0.3115 0.0143 230)
 *   --hvv(cobalt, 3, 18)        → oklch(0.3727 0.0081 250)
 *   --hvv(black, 0, 0, 0.5)     → oklch(0 0 0 / 0.5)
 *   --hvv(white, 0, 100, 0.06)  → oklch(1 0 0 / 0.06)
 *
 * Raw angle examples:
 *   --hvv(237, 5, 13)     → uses findMaxChroma() at canonicalL=0.77
 *   --hvv(hue-264, 4, 7)  → same as --hvv(264, 4, 7); produced by oklchToHVV()
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
 * Group 1: hue — one of:
 *   - Named hue word: `[a-z]+` (e.g. "blue", "cobalt", "black", "white")
 *   - Raw angle: `\d+(?:\.\d+)?` (e.g. "237")
 *   - oklchToHVV() raw-angle form: `hue-\d+` (e.g. "hue-264" → angle 264)
 * Group 2: vibrancy (decimal number)
 * Group 3: value (decimal number)
 * Group 4: alpha (optional decimal number, 0–1)
 *
 * The `g` flag allows replaceAll-style iteration over multiple calls in one
 * declaration value.
 */
const HVV_PATTERN = /--hvv\(\s*(hue-\d+|[a-z]+|\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d*\.?\d+)\s*)?\)/g;

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
 * Expand a single --hvv(hue, vib, val[, alpha]) call to an oklch() string.
 *
 * Special achromatic keywords:
 *   "black" → oklch(0 0 0 [/ alpha])  — true black, ignores vib/val
 *   "white" → oklch(1 0 0 [/ alpha])  — true white, ignores vib/val
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
function expandHvv(hueArg: string, vibArg: string, valArg: string, alphaArg?: string): string {
  const alphaSuffix = alphaArg !== undefined ? ` / ${alphaArg}` : "";

  // Special achromatic keywords — exact L values, no piecewise formula
  if (hueArg === "black") {
    return `oklch(0 0 0${alphaSuffix})`;
  }
  if (hueArg === "white") {
    return `oklch(1 0 0${alphaSuffix})`;
  }

  const vib = parseFloat(vibArg);
  const val = parseFloat(valArg);

  let h: number;
  let canonicalL: number;
  let peakC: number;

  const namedAngle = HUE_FAMILIES[hueArg];
  if (namedAngle !== undefined) {
    // Named hue path (e.g. "blue", "cobalt")
    h = namedAngle;
    canonicalL = DEFAULT_CANONICAL_L[hueArg] ?? RAW_ANGLE_CANONICAL_L;
    const maxC = MAX_CHROMA_FOR_HUE[hueArg] ?? 0.022;
    peakC = maxC * PEAK_C_SCALE;
  } else if (hueArg.startsWith("hue-")) {
    // oklchToHVV() raw-angle form: "hue-264" → angle 264
    h = parseFloat(hueArg.slice(4));
    canonicalL = RAW_ANGLE_CANONICAL_L;
    peakC = findMaxChroma(canonicalL, h) * PEAK_C_SCALE;
  } else {
    // Raw numeric angle path (e.g. "237")
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

  return `oklch(${fmt(L)} ${fmt(C)} ${h}${alphaSuffix})`;
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
        (_match, hue, vib, val, alpha) =>
          expandHvv(hue as string, vib as string, val as string, alpha as string | undefined),
      );
    },
  };
}

postcssHvv.postcss = true;
