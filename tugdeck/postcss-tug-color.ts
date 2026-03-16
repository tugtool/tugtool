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
 *   <color>     := <hue-name> | <hue-name>-<adjacent-hue> | black | white | gray
 *                  | <hue-name>-<preset> | <hue-name>-<adjacent-hue>-<preset>
 *   <hue-name>  := one of 48 named hues (garnet, cherry, scarlet, … berry)
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
 *   gray  — achromatic pseudo-hue; canonical L=0.5, C=0; tone controls lightness
 *
 * Named hue examples:
 *   --tug-color(blue, i: 5, t: 13)              → oklch(0.3115 0.0143 230)
 *   --tug-color(cobalt-indigo, i: 7, t: 37)     → hyphenated adjacency hue
 *   --tug-color(cobalt-indigo-intense)           → adjacency + preset
 *   --tug-color(black, i: 0, t: 0, a: 50)       → oklch(0 0 0 / 0.5)
 *
 * Multiple calls in a single declaration are all expanded.
 * Values without --tug-color() are passed through unchanged.
 * Parse errors (including non-adjacent pairs) propagate as PostCSS errors that
 * fail the build.
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
  ADJACENCY_RING,
  resolveHyphenatedHue,
} from "./src/components/tugways/palette-engine";
import { parseTugColor, findTugColorCallsWithWarnings } from "./tug-color-parser";
import type { TugColorValue } from "./tug-color-parser";

// ---------------------------------------------------------------------------
// Known hues set (for parseTugColor validation)
// ---------------------------------------------------------------------------

const KNOWN_HUES: ReadonlySet<string> = new Set([
  ...Object.keys(HUE_FAMILIES),
  "black",
  "white",
  "gray",
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
 * For named hues without adjacency: uses DEFAULT_CANONICAL_L[hue] and
 *   MAX_CHROMA_FOR_HUE[hue] for exact named-hue paths.
 *
 * For hyphenated adjacency hues (adjacentName present):
 *   - Resolved angle via resolveHyphenatedHue(name, adjacentName)
 *   - canonicalL from DEFAULT_CANONICAL_L[name] (primary/dominant hue)
 *   - peakC computed dynamically via findMaxChroma(canonicalL, resolvedAngle) * PEAK_C_SCALE
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
  color: TugColorValue,
  intensity: number,
  tone: number,
  alpha: number,
): string {
  const alphaSuffix = alpha < 100 ? ` / ${fmt(alpha / 100)}` : "";

  // Special achromatic keywords — exact L values, no piecewise formula
  if (color.name === "black") {
    return `oklch(0 0 0${alphaSuffix})`;
  }
  if (color.name === "white") {
    return `oklch(1 0 0${alphaSuffix})`;
  }
  // Gray pseudo-hue: achromatic (C=0), canonical L=0.5, participates in tone formula.
  // Intensity is accepted but silently ignored.
  if (color.name === "gray") {
    const GRAY_CANONICAL_L = 0.5;
    const L =
      L_DARK +
      Math.min(tone, 50) * (GRAY_CANONICAL_L - L_DARK) / 50 +
      Math.max(tone - 50, 0) * (L_LIGHT - GRAY_CANONICAL_L) / 50;
    return `oklch(${fmt(L)} 0 0${alphaSuffix})`;
  }

  const baseAngle = HUE_FAMILIES[color.name];
  if (baseAngle === undefined) {
    // Unknown hue — emit as comment placeholder (shouldn't happen if parseTugColor validated)
    return `oklch(0.5 0 0${alphaSuffix})`;
  }

  let h: number;
  let canonicalL: number;
  let peakC: number;

  if (color.adjacentName) {
    // Hyphenated adjacency path: resolve angle via weighted blend
    h = resolveHyphenatedHue(color.name, color.adjacentName);
    canonicalL = DEFAULT_CANONICAL_L[color.name] ?? 0.77;
    // Compute peakC dynamically at the resolved hyphenated angle
    peakC = findMaxChroma(canonicalL, h) * PEAK_C_SCALE;
  } else {
    // Exact named hue path
    h = baseAngle;
    canonicalL = DEFAULT_CANONICAL_L[color.name] ?? 0.77;
    const maxC = MAX_CHROMA_FOR_HUE[color.name] ?? 0.022;
    peakC = maxC * PEAK_C_SCALE;
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

      const { calls, warnings: scanWarnings } = findTugColorCallsWithWarnings(decl.value);
      for (const warn of scanWarnings) {
        console.warn(`postcss-tug-color: ${warn.message}`);
      }
      if (calls.length === 0) return;

      // Process in reverse order to preserve string indices
      let result = decl.value;
      for (let i = calls.length - 1; i >= 0; i--) {
        const call = calls[i];
        const parseResult = parseTugColor(
          call.inner,
          KNOWN_HUES,
          refreshPresets(),
          ADJACENCY_RING,
        );

        if (!parseResult.ok) {
          for (const err of parseResult.errors) {
            const msg = `postcss-tug-color: ${err.message} in: --tug-color(${call.inner})`;
            throw decl.error(msg);
          }
          continue;
        }

        if (parseResult.warnings) {
          for (const warn of parseResult.warnings) {
            console.warn(`postcss-tug-color: ${warn.message} in: --tug-color(${call.inner})`);
          }
        }

        const { color, intensity, tone, alpha } = parseResult.value;
        const expanded = expandTugColor(color, intensity, tone, alpha);
        result = result.slice(0, call.start) + expanded + result.slice(call.end);
      }

      decl.value = result;
    },
  };
}

postcssTugColor.postcss = true;
