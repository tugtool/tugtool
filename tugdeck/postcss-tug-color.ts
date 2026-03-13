/**
 * postcss-tug-color — PostCSS plugin for --tug-color() color notation expansion.
 *
 * Expands `--tug-color(color, i: intensity, t: tone)` calls in CSS declaration values
 * to concrete `oklch(L C h)` strings at build time. Zero runtime cost; all
 * computation happens during the Vite/PostCSS build pipeline.
 *
 * Syntax:
 *   --tug-color( <color> [, i: <intensity>] [, t: <tone>] [, a: <alpha>] )
 *
 *   <color>     := <hue-name>[+/-<offset>] | black | white
 *   <hue-name>  := cherry | red | tomato | flame | orange | amber | gold | yellow
 *                | lime | green | mint | teal | cyan | sky | blue | cobalt
 *                | violet | purple | plum | pink | rose | magenta | berry | coral
 *   <intensity> := <number>   // 0–100 (default 50)
 *   <tone>      := <number>   // 0–100 (default 50)
 *   <alpha>     := <number>   // 0–100 (default 100, fully opaque)
 *
 * Labeled arguments (i:, t:, a:) may appear in any order after the color.
 * Positional arguments (color, intensity, tone, alpha) are also supported.
 *
 * Special achromatic keywords:
 *   black — always expands to oklch(0 0 0), ignoring intensity/tone
 *   white — always expands to oklch(1 0 0), ignoring intensity/tone
 *
 * Named hue examples:
 *   --tug-color(blue, i: 5, t: 13)          → oklch(0.3115 0.0143 230)
 *   --tug-color(cobalt, i: 3, t: 18)        → oklch(0.3727 0.0081 250)
 *   --tug-color(black, i: 0, t: 0, a: 50)  → oklch(0 0 0 / 0.5)
 *   --tug-color(white, i: 0, t: 100, a: 6) → oklch(1 0 0 / 0.06)
 *   --tug-color(red+5, i: 30, t: 70)        → resolved angle = red(25)+5 = 30
 *
 * Multiple calls in a single declaration are all expanded.
 * Values without --tug-color() are passed through unchanged.
 *
 * Import path: use explicit relative path from vite.config.ts (no @/ alias
 * in Node/Bun PostCSS context). Bun's native TS support handles .ts imports.
 *
 * @module postcss-tug-color
 */

import type { Plugin } from "postcss";
import fs from "fs";
import path from "path";
import {
  HUE_FAMILIES,
  DEFAULT_CANONICAL_L,
  MAX_CHROMA_FOR_HUE,
  PEAK_C_SCALE,
  L_DARK,
  L_LIGHT,
  findMaxChroma,
  TUG_COLOR_PRESETS,
} from "./src/components/tugways/palette-engine";
import { parseTugColor, findTugColorCalls } from "./tug-color-parser";

// ---------------------------------------------------------------------------
// Known hues set (for parseTugColor validation)
// ---------------------------------------------------------------------------

const KNOWN_HUES: ReadonlySet<string> = new Set([
  ...Object.keys(HUE_FAMILIES),
  "black",
  "white",
]);

// ---------------------------------------------------------------------------
// Known presets — auto-refresh from palette-engine.ts on mtime change
// ---------------------------------------------------------------------------

const PALETTE_ENGINE_PATH = path.resolve(
  __dirname,
  "src/components/tugways/palette-engine.ts",
);

let knownPresets: ReadonlyMap<string, { intensity: number; tone: number }> =
  new Map(Object.entries(TUG_COLOR_PRESETS));
let lastMtime = 0;

/** Re-read presets from the source file if it has changed since last check. */
function refreshPresets(): ReadonlyMap<string, { intensity: number; tone: number }> {
  try {
    const mtime = fs.statSync(PALETTE_ENGINE_PATH).mtimeMs;
    if (mtime === lastMtime) return knownPresets;
    lastMtime = mtime;

    const src = fs.readFileSync(PALETTE_ENGINE_PATH, "utf-8");
    const presets: Record<string, { intensity: number; tone: number }> = {};
    const re = /(\w+):\s*\{\s*intensity:\s*(\d+),\s*tone:\s*(\d+)\s*\}/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      presets[m[1]] = { intensity: Number(m[2]), tone: Number(m[3]) };
    }
    if (Object.keys(presets).length > 0) {
      knownPresets = new Map(Object.entries(presets));
    }
  } catch {
    // File read failed — keep existing presets.
  }
  return knownPresets;
}

// ---------------------------------------------------------------------------
// Formatting helper (matches tugColor() precision convention)
// ---------------------------------------------------------------------------

/** Format a number to 4 decimal places with trailing zeros stripped. */
function fmt(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}

// ---------------------------------------------------------------------------
// Core expansion logic
// ---------------------------------------------------------------------------

/**
 * Expand a single parsed --tug-color() call to an oklch() string.
 *
 * Special achromatic keywords:
 *   "black" → oklch(0 0 0 [/ alpha])  — true black, ignores intensity/tone
 *   "white" → oklch(1 0 0 [/ alpha])  — true white, ignores intensity/tone
 *
 * For named hues: uses DEFAULT_CANONICAL_L[hue] and MAX_CHROMA_FOR_HUE[hue].
 * For hues with offsets: resolved angle = HUE_FAMILIES[name] + offset, mod 360.
 *   peakC is computed dynamically via findMaxChroma() at the resolved angle.
 *
 * L formula (piecewise, matching tugColor()):
 *   L = L_DARK + min(tone, 50) * (canonicalL - L_DARK) / 50
 *             + max(tone - 50, 0) * (L_LIGHT - canonicalL) / 50
 *
 * C formula (linear):
 *   C = (intensity / 100) * peakC   where peakC = maxChroma * PEAK_C_SCALE
 *
 * Alpha: parsed alpha is 0-100; emitted as `/ ${alpha/100}` in oklch output.
 * Only emit alpha suffix if alpha < 100.
 */
function expandTugColor(
  colorName: string,
  colorOffset: number,
  intensity: number,
  tone: number,
  alpha: number,
): string {
  const alphaSuffix = alpha < 100 ? ` / ${fmt(alpha / 100)}` : "";

  // Special achromatic keywords — exact L values, no piecewise formula
  if (colorName === "black") {
    return `oklch(0 0 0${alphaSuffix})`;
  }
  if (colorName === "white") {
    return `oklch(1 0 0${alphaSuffix})`;
  }

  const baseAngle = HUE_FAMILIES[colorName];
  if (baseAngle === undefined) {
    // Unknown hue — emit as comment placeholder (shouldn't happen if parseTugColor validated)
    return `oklch(0.5 0 0${alphaSuffix})`;
  }

  let h: number;
  let canonicalL: number;
  let peakC: number;

  if (colorOffset === 0) {
    // Exact named hue path
    h = baseAngle;
    canonicalL = DEFAULT_CANONICAL_L[colorName] ?? 0.77;
    const maxC = MAX_CHROMA_FOR_HUE[colorName] ?? 0.022;
    peakC = maxC * PEAK_C_SCALE;
  } else {
    // Hue with offset: resolved angle = base + offset, mod 360
    h = ((baseAngle + colorOffset) % 360 + 360) % 360;
    canonicalL = DEFAULT_CANONICAL_L[colorName] ?? 0.77;
    // For offset hues, compute peakC dynamically at the resolved angle
    peakC = findMaxChroma(canonicalL, h) * PEAK_C_SCALE;
  }

  // tone → L: piecewise formula (matches tugColor() exactly)
  const L =
    L_DARK +
    Math.min(tone, 50) * (canonicalL - L_DARK) / 50 +
    Math.max(tone - 50, 0) * (L_LIGHT - canonicalL) / 50;

  // intensity → C: linear
  const C = (intensity / 100) * peakC;

  return `oklch(${fmt(L)} ${fmt(C)} ${h}${alphaSuffix})`;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * PostCSS plugin factory that expands `--tug-color()` notation to `oklch()` values.
 *
 * Usage in vite.config.ts:
 *   import postcssTugColor from "./postcss-tug-color";
 *   // ...
 *   css: { postcss: { plugins: [postcssTugColor()] } }
 *
 * @returns A PostCSS Plugin object.
 */
export default function postcssTugColor(): Plugin {
  return {
    postcssPlugin: "postcss-tug-color",
    Declaration(decl) {
      if (!decl.value.includes("--tug-color(")) return;

      const calls = findTugColorCalls(decl.value);
      if (calls.length === 0) return;

      // Process in reverse order to preserve string indices
      let result = decl.value;
      for (let i = calls.length - 1; i >= 0; i--) {
        const call = calls[i];
        const parseResult = parseTugColor(call.inner, KNOWN_HUES, refreshPresets());

        if (!parseResult.ok) {
          for (const err of parseResult.errors) {
            console.warn(`postcss-tug-color: ${err.message} (at pos ${err.pos}) in: ${call.inner}`);
          }
          continue;
        }

        const { color, intensity, tone, alpha } = parseResult.value;
        const expanded = expandTugColor(color.name, color.offset, intensity, tone, alpha);
        result = result.slice(0, call.start) + expanded + result.slice(call.end);
      }

      decl.value = result;
    },
  };
}

postcssTugColor.postcss = true;
