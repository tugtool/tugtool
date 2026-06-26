/**
 * postcss-tug-color — PostCSS plugin for --tug-color() color notation expansion.
 *
 * Expands `--tug-color(color, l: lightness, c: chroma)` calls in CSS declaration
 * values to concrete `oklch(L C h)` strings at build time. Zero runtime cost; all
 * computation happens during the Vite/PostCSS build pipeline.
 *
 * Syntax:
 *   --tug-color( <color> [, l: <lightness>] [, c: <chroma>] [, a: <alpha>] )
 *
 *   <color>     := <hue-name> | <hue-name>-<adjacent-hue> | black | white | gray
 *                  | <named-gray> | transparent
 *   <hue-name>  := one of 48 named hues (garnet, cherry, scarlet, … berry)
 *   <lightness> := <number>   // OKLCH lightness, 0–1 (required for chromatic + gray)
 *   <chroma>    := <number>   // OKLCH chroma, 0–~0.4 (required for chromatic)
 *   <alpha>     := <number>   // 0–1 (default 1, fully opaque)
 *
 * Labeled arguments (l:, c:, a:) may appear in any order after the color.
 * Positional order (color, lightness, chroma, alpha) is also supported.
 *
 * Special achromatic keywords:
 *   black       — always expands to oklch(0 0 0), ignoring l/c
 *   white       — always expands to oklch(1 0 0), ignoring l/c
 *   gray        — achromatic pseudo-hue; C=0; `l` controls lightness
 *   paper…pitch — 9 named grays with fixed L values (see NAMED_GRAYS); ignore l/c, honor alpha
 *   transparent — always expands to oklch(0 0 0 / 0), ignoring all args
 *
 * Examples:
 *   --tug-color(blue, l: 0.3115, c: 0.0143)     → oklch(0.3115 0.0143 230)
 *   --tug-color(cobalt-indigo, l: 0.3, c: 0.05) → hyphenated adjacency hue
 *   --tug-color(black, a: 0.5)                  → oklch(0 0 0 / 0.5)
 *   --tug-color(paper)                          → oklch(0.22 0 0)
 *   --tug-color(gray, l: 0.43)                  → oklch(0.43 0 0)
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
import {
  HUE_FAMILIES,
  ADJACENCY_RING,
  NAMED_GRAYS,
  resolveTugColorToOklch,
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
  ...NAMED_GRAYS,
  "transparent",
]);

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
 * All resolution lives in resolveTugColorToOklch (single source of truth shared with
 * the CLI contrast audit) — here we only format the numeric result. Alpha is a 0–1
 * fraction; the `/ alpha` suffix is emitted only when alpha < 1.
 */
function expandTugColor(
  color: TugColorValue,
  lightness: number,
  chroma: number,
  alpha: number,
): string {
  const { L, C, h, alpha: a } = resolveTugColorToOklch(
    color.name,
    color.adjacentName,
    lightness,
    chroma,
    alpha,
  );
  const alphaSuffix = a < 1 ? ` / ${fmt(a)}` : "";
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

        const { color, lightness, chroma, alpha } = parseResult.value;
        const expanded = expandTugColor(color, lightness, chroma, alpha);
        result = result.slice(0, call.start) + expanded + result.slice(call.end);
      }

      decl.value = result;
    },
  };
}

postcssTugColor.postcss = true;
