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
 *   black       — always expands to oklch(0 0 0), ignoring intensity/tone
 *   white       — always expands to oklch(1 0 0), ignoring intensity/tone
 *   gray        — achromatic pseudo-hue; canonical L=0.5, C=0; tone controls lightness
 *   paper…pitch — 9 named grays with fixed L values (see NAMED_GRAYS); ignore i/t, honor alpha
 *   transparent — always expands to oklch(0 0 0 / 0), ignoring all args
 *
 * Achromatic adjacency:
 *   Consecutive pairs in the linear sequence [black, paper, …, pitch, white] may be
 *   hyphenated as A-B, resolving to (2/3)*L(A) + (1/3)*L(B).
 *   e.g. --tug-color(paper-linen) → oklch(0.2433 0 0)
 *
 * Named hue examples:
 *   --tug-color(blue, i: 5, t: 13)              → oklch(0.3115 0.0143 230)
 *   --tug-color(cobalt-indigo, i: 7, t: 37)     → hyphenated adjacency hue
 *   --tug-color(cobalt-indigo-intense)           → adjacency + preset
 *   --tug-color(black, i: 0, t: 0, a: 50)       → oklch(0 0 0 / 0.5)
 *   --tug-color(paper)                          → oklch(0.22 0 0)
 *   --tug-color(paper-linen)                    → oklch(0.2433 0 0)
 *   --tug-color(transparent)                    → oklch(0 0 0 / 0)
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
  NAMED_GRAYS,
  ACHROMATIC_SEQUENCE,
  ACHROMATIC_L_VALUES,
  resolveAchromaticAdjacency,
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
  ...Object.keys(NAMED_GRAYS),
  "transparent",
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
 * Expansion order (each tier returns early, preventing double-handling):
 *
 *   1. Achromatic adjacency (FIRST): if adjacentName is present AND both name and
 *      adjacentName are in ACHROMATIC_SEQUENCE, resolve via resolveAchromaticAdjacency().
 *      Must come before black/white/named-gray early returns so that endpoint pairs
 *      (black-paper, pitch-white) are not silently broken.
 *
 *   2. Transparent: always returns oklch(0 0 0 / 0) regardless of i/t/a values.
 *
 *   3. Black/white: exact L values (0 and 1), intensity/tone ignored, alpha honored.
 *
 *   4. Named grays (pitch through paper): fixed L from ACHROMATIC_L_VALUES keyed by
 *      the inherent tone in NAMED_GRAYS; intensity and tone are ignored per [D06];
 *      alpha IS honored.
 *
 *   5. Gray pseudo-hue: achromatic (C=0), canonical L=0.5, tone participates in the
 *      piecewise formula; intensity silently ignored.
 *
 *   6. Chromatic hues: standard path — named hue or hyphenated chromatic adjacency.
 *
 * Alpha: parsed alpha is 0–100; emitted as `/ ${alpha/100}` in oklch output.
 * Only emitted when alpha < 100.
 */
function expandTugColor(
  color: TugColorValue,
  intensity: number,
  tone: number,
  alpha: number,
): string {
  const alphaSuffix = alpha < 100 ? ` / ${fmt(alpha / 100)}` : "";

  // ── Tier 1: Achromatic adjacency ──────────────────────────────────────────
  // Must come FIRST — before black/white/named-gray early returns — so that
  // endpoint pairs (black-paper, pitch-white) are not silently broken.
  if (color.adjacentName !== undefined) {
    const idxA = ACHROMATIC_SEQUENCE.indexOf(color.name);
    const idxB = ACHROMATIC_SEQUENCE.indexOf(color.adjacentName);
    if (idxA !== -1 && idxB !== -1) {
      if (color.preset !== undefined) {
        console.warn(
          `postcss-tug-color: preset '${color.preset}' is ignored for achromatic adjacency pair '${color.name}-${color.adjacentName}' (L is fixed by the 2/3+1/3 blend)`
        );
      }
      const blendedL = resolveAchromaticAdjacency(color.name, color.adjacentName);
      return `oklch(${fmt(blendedL)} 0 0${alphaSuffix})`;
    }
  }

  // ── Tier 2: Transparent ───────────────────────────────────────────────────
  if (color.name === "transparent") {
    return "oklch(0 0 0 / 0)";
  }

  // ── Tier 3: Black / white ─────────────────────────────────────────────────
  if (color.name === "black") {
    return `oklch(0 0 0${alphaSuffix})`;
  }
  if (color.name === "white") {
    return `oklch(1 0 0${alphaSuffix})`;
  }

  // ── Tier 4: Named grays (pitch through paper) ─────────────────────────────
  // Fixed lightness per [D06]: look up inherent tone from NAMED_GRAYS,
  // use the pre-computed L from ACHROMATIC_L_VALUES. Intensity and tone ignored.
  const namedGrayTone = NAMED_GRAYS[color.name];
  if (namedGrayTone !== undefined) {
    const L = ACHROMATIC_L_VALUES[color.name] ?? 0.5;
    return `oklch(${fmt(L)} 0 0${alphaSuffix})`;
  }

  // ── Tier 5: Gray pseudo-hue ───────────────────────────────────────────────
  // Achromatic (C=0), canonical L=0.5; tone participates in the piecewise formula.
  if (color.name === "gray") {
    const GRAY_CANONICAL_L = 0.5;
    const L =
      L_DARK +
      Math.min(tone, 50) * (GRAY_CANONICAL_L - L_DARK) / 50 +
      Math.max(tone - 50, 0) * (L_LIGHT - GRAY_CANONICAL_L) / 50;
    return `oklch(${fmt(L)} 0 0${alphaSuffix})`;
  }

  // ── Tier 6: Chromatic hues ────────────────────────────────────────────────
  const baseAngle = HUE_FAMILIES[color.name];
  if (baseAngle === undefined) {
    // Unknown hue — should not happen if parseTugColor validated correctly
    return `oklch(0.5 0 0${alphaSuffix})`;
  }

  let h: number;
  let canonicalL: number;
  let peakC: number;

  if (color.adjacentName) {
    // Chromatic hyphenated adjacency: resolve angle via weighted hue-angle blend
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
          ACHROMATIC_SEQUENCE,
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
