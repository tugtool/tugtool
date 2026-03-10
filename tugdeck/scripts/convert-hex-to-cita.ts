/**
 * convert-hex-to-cita — One-time hex-to-CITA conversion script for theme files.
 *
 * Reads a CSS file, walks its PostCSS AST, replaces standalone #hex color
 * values in Declaration nodes with --cita(hue, i: intensity, t: tone) notation,
 * and writes the result back to the file.
 *
 * Hex values inside CSS function calls (rgba(), url(), etc.) are
 * preserved unchanged. Comments are separate AST nodes and are never visited,
 * so hex references in comments are automatically preserved.
 *
 * Special case: #ffffff → var(--tug-white)
 *
 * Usage (run from the tugdeck directory):
 *   bun run scripts/convert-hex-to-cita.ts <css-file-path> [--validate]
 *
 * Options:
 *   --validate   After conversion, run round-trip validation comparing
 *                original hex oklch values against PostCSS-expanded output.
 *                Prints a report but does not fail on delta-E < 0.01.
 *
 * @module scripts/convert-hex-to-cita
 */

import { readFileSync, writeFileSync } from "fs";
import postcss from "postcss";
import type { Declaration } from "postcss";
import { oklchToCITA } from "../src/components/tugways/palette-engine";
import postcssCita from "../postcss-cita";

// ---------------------------------------------------------------------------
// Hex → sRGB → linear sRGB → OKLab → OKLCH
// ---------------------------------------------------------------------------

/**
 * Parse a 6-digit or 3-digit hex color string to sRGB [0, 1] channels.
 * Accepts "#rrggbb" or "#rgb" forms. Returns null for unrecognised input.
 */
export function hexToSRGB(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16) / 255;
    const g = parseInt(h[1] + h[1], 16) / 255;
    const b = parseInt(h[2] + h[2], 16) / 255;
    return { r, g, b };
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    return { r, g, b };
  }
  return null;
}

/**
 * Convert a linear-light sRGB channel to gamma-encoded sRGB.
 * Inverse of sRGBToLinear.
 */
function linearToSRGB(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
void linearToSRGB; // exported for tests via hexToOklch indirectly

/**
 * Convert a gamma-encoded sRGB channel to linear light.
 * Per IEC 61966-2-1.
 */
export function sRGBToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Convert linear sRGB channels to OKLCH.
 *
 * Pipeline (inverse of oklchToLinearSRGB in palette-engine.ts):
 *   1. linear sRGB → LMS  (M2⁻¹ matrix)
 *   2. LMS → LMS^  (cube root)
 *   3. LMS^ → OKLab  (M1 matrix)
 *   4. OKLab → OKLCH  (Cartesian → polar)
 *
 * Matrices from: https://bottosson.github.io/posts/oklab/
 */
export function linearSRGBToOklch(
  r: number,
  g: number,
  b: number,
): { L: number; C: number; h: number } {
  // Step 1: linear sRGB → LMS
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  // Step 2: LMS → LMS^ (cube root)
  const lHat = Math.cbrt(l);
  const mHat = Math.cbrt(m);
  const sHat = Math.cbrt(s);

  // Step 3: LMS^ → OKLab
  const L = 0.2104542553 * lHat + 0.7936177850 * mHat - 0.0040720468 * sHat;
  const a = 1.9779984951 * lHat - 2.4285922050 * mHat + 0.4505937099 * sHat;
  const bLab = 0.0259040371 * lHat + 0.7827717662 * mHat - 0.8086757660 * sHat;

  // Step 4: OKLab → OKLCH (Cartesian → polar)
  const C = Math.sqrt(a * a + bLab * bLab);
  let h = (Math.atan2(bLab, a) * 180) / Math.PI;
  if (h < 0) h += 360;

  return { L, C, h };
}

/**
 * Convert a hex color string to an oklch() CSS string.
 * Returns null if the hex is not parseable.
 */
export function hexToOklch(hex: string): string | null {
  const srgb = hexToSRGB(hex);
  if (!srgb) return null;
  const linR = sRGBToLinear(srgb.r);
  const linG = sRGBToLinear(srgb.g);
  const linB = sRGBToLinear(srgb.b);
  const { L, C, h } = linearSRGBToOklch(linR, linG, linB);
  const fmt = (n: number) => parseFloat(n.toFixed(4)).toString();
  return `oklch(${fmt(L)} ${fmt(C)} ${fmt(h)})`;
}

// ---------------------------------------------------------------------------
// RGBA → CITA conversion
// ---------------------------------------------------------------------------

/**
 * Pattern matching rgba(R, G, B, A) calls.
 * Groups: 1=R, 2=G, 3=B, 4=A
 * Handles integer (0-255) channels and decimal alpha.
 */
const RGBA_PATTERN =
  /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+(?:\.\d+)?)\s*\)/g;

/**
 * Convert an rgba(R, G, B, A) call to --cita(hue, i: intensity, t: tone, a: alpha) notation.
 *
 * Special cases:
 *   rgba(0, 0, 0, A)       → --cita(black, 0, 0, A)
 *   rgba(255, 255, 255, A)  → --cita(white, 0, 100, A)
 *
 * All other rgba values are converted through sRGB → OKLCH → CITA.
 */
function convertRgbaToCita(
  r: number,
  g: number,
  b: number,
  alpha: string,
): string {
  // Pure black
  if (r === 0 && g === 0 && b === 0) {
    return `--cita(black, 0, 0, ${alpha})`;
  }
  // Pure white
  if (r === 255 && g === 255 && b === 255) {
    return `--cita(white, 0, 100, ${alpha})`;
  }

  // General case: sRGB → linear → OKLCH → CITA
  const linR = sRGBToLinear(r / 255);
  const linG = sRGBToLinear(g / 255);
  const linB = sRGBToLinear(b / 255);
  const { L, C, h } = linearSRGBToOklch(linR, linG, linB);
  const fmt = (n: number) => parseFloat(n.toFixed(4)).toString();
  const oklchStr = `oklch(${fmt(L)} ${fmt(C)} ${fmt(h)})`;
  const { hue, intensity, tone } = oklchToCITA(oklchStr);
  return `--cita(${hue}, i: ${intensity}, t: ${tone}, a: ${Math.round(parseFloat(alpha) * 100)})`;
}

/**
 * Convert all rgba() calls in a CSS declaration value to --cita() notation.
 * Non-rgba values are left unchanged.
 */
export function convertValueRgbaToCita(value: string): string {
  RGBA_PATTERN.lastIndex = 0;
  return value.replace(RGBA_PATTERN, (_match, r, g, b, a) =>
    convertRgbaToCita(parseInt(r), parseInt(g), parseInt(b), a),
  );
}

// ---------------------------------------------------------------------------
// Standalone hex detection
// ---------------------------------------------------------------------------

/**
 * Pattern matching a standalone #hex value (6 or 3 hex digits).
 * Uses word boundaries / surrounding context to avoid matching hex inside
 * CSS function arguments like rgba(#hex, ...) — but the primary protection
 * is the isHexInsideFunction() check below.
 */
const HEX_PATTERN = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;

/**
 * Determine whether a #hex occurrence at `hexIndex` in `value` is inside
 * a CSS function call (rgba, url, linear-gradient, etc.).
 *
 * Walks backwards from hexIndex looking for an opening parenthesis that is
 * preceded by a word character (i.e. a function name). If found before
 * encountering a closing paren or the start of the string, the hex is
 * considered inside a function.
 */
export function isHexInsideFunction(value: string, hexIndex: number): boolean {
  let depth = 0;
  for (let i = hexIndex - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === ")") {
      depth++;
    } else if (ch === "(") {
      if (depth > 0) {
        depth--;
      } else {
        // Found unmatched opening paren — check if preceded by a word char
        if (i > 0 && /\w/.test(value[i - 1])) {
          return true;
        }
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Single-value converter
// ---------------------------------------------------------------------------

/**
 * Convert all standalone hex values in a CSS declaration value string to
 * --cita() notation (or var(--tug-white) for #ffffff).
 *
 * Hex values inside function calls are left unchanged.
 * Non-hex values are left unchanged.
 */
export function convertValueHexToCita(value: string): string {
  // Reset lastIndex since we're reusing the pattern across calls
  HEX_PATTERN.lastIndex = 0;

  // Collect replacements first (avoid mutating while iterating)
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = HEX_PATTERN.exec(value)) !== null) {
    const hexStart = match.index;
    const hexEnd = hexStart + match[0].length;

    if (isHexInsideFunction(value, hexStart)) {
      continue;
    }

    const hex = match[0].toLowerCase();

    let replacement: string;
    if (hex === "#ffffff") {
      replacement = "var(--tug-white)";
    } else {
      const oklch = hexToOklch(hex);
      if (!oklch) continue;
      const { hue, intensity, tone } = oklchToCITA(oklch);
      replacement = `--cita(${hue}, i: ${intensity}, t: ${tone})`;
    }

    replacements.push({ start: hexStart, end: hexEnd, replacement });
  }

  if (replacements.length === 0) return value;

  // Apply replacements in reverse order to preserve indices
  let result = value;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end, replacement } = replacements[i];
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return result;
}

// ---------------------------------------------------------------------------
// CSS file conversion
// ---------------------------------------------------------------------------

/**
 * Convert all standalone hex values in a CSS file to --cita() notation.
 * Reads the file, walks the PostCSS AST, replaces declaration values,
 * and writes the result back.
 *
 * @param filePath - Absolute or relative path to the CSS file.
 * @returns The converted CSS string.
 */
export function convertCSSFile(filePath: string): string {
  const source = readFileSync(filePath, "utf8");
  const root = postcss.parse(source, { from: filePath });

  root.walkDecls((decl: Declaration) => {
    // Convert hex values
    if (decl.value.includes("#")) {
      const converted = convertValueHexToCita(decl.value);
      if (converted !== decl.value) {
        decl.value = converted;
      }
    }
    // Convert rgba() values
    if (decl.value.includes("rgba(")) {
      const converted = convertValueRgbaToCita(decl.value);
      if (converted !== decl.value) {
        decl.value = converted;
      }
    }
  });

  const output = root.toResult().css;
  writeFileSync(filePath, output, "utf8");
  return output;
}

// ---------------------------------------------------------------------------
// Round-trip validation
// ---------------------------------------------------------------------------

/**
 * OKLCH delta-E: Euclidean distance in OKLCH space (approximates perceptual delta).
 * Wraps hue difference to [-180, 180] range.
 */
export function oklchDeltaE(
  a: { L: number; C: number; h: number },
  b: { L: number; C: number; h: number },
): number {
  const dL = a.L - b.L;
  const dC = a.C - b.C;
  let dH = a.h - b.h;
  if (dH > 180) dH -= 360;
  if (dH < -180) dH += 360;
  // Convert hue arc to Cartesian distance at the average chroma
  const avgC = (a.C + b.C) / 2;
  const dHCart = 2 * avgC * Math.sin((dH * Math.PI) / 180 / 2);
  return Math.sqrt(dL * dL + dC * dC + dHCart * dHCart);
}

/**
 * Parse an oklch() string to numeric components. Returns null on failure.
 */
export function parseOklchString(s: string): { L: number; C: number; h: number } | null {
  const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!m) return null;
  return { L: parseFloat(m[1]), C: parseFloat(m[2]), h: parseFloat(m[3]) };
}

/**
 * Validate round-trip accuracy of a converted CSS string.
 *
 * For each --cita() call in the converted CSS, expands it via postcss-cita and
 * compares the resulting oklch against the original hex-derived oklch.
 * Reports any conversions with delta-E >= threshold.
 *
 * @param originalSource - The original CSS before conversion.
 * @param convertedSource - The CSS after hex-to-cita conversion.
 * @param threshold - Delta-E threshold for flagging (default 0.01).
 * @returns Array of validation failures.
 */
export function validateRoundTrip(
  originalSource: string,
  convertedSource: string,
  threshold = 0.01,
): Array<{ prop: string; original: string; expanded: string; deltaE: number }> {
  const failures: Array<{ prop: string; original: string; expanded: string; deltaE: number }> = [];

  // Parse both versions into PostCSS ASTs
  const originalRoot = postcss.parse(originalSource);
  const convertedRoot = postcss.parse(convertedSource);

  // Expand --cita() calls in the converted CSS via the plugin
  const expandedSource = postcss([postcssCita()]).process(convertedSource, { from: undefined }).css;
  const expandedRoot = postcss.parse(expandedSource);

  // Build a map of prop → original hex value from the original AST
  const originalValues = new Map<string, string>();
  originalRoot.walkDecls((decl: Declaration) => {
    if (decl.value.includes("#")) {
      originalValues.set(decl.prop, decl.value);
    }
  });

  // For each declaration in the converted AST that was changed, compare
  convertedRoot.walkDecls((decl: Declaration) => {
    if (!decl.value.includes("--cita(") && !decl.value.includes("var(--tug-white)")) return;

    const origValue = originalValues.get(decl.prop);
    if (!origValue) return;

    // Find the corresponding expanded declaration
    let expandedValue: string | undefined;
    expandedRoot.walkDecls((eDecl: Declaration) => {
      if (eDecl.prop === decl.prop) {
        expandedValue = eDecl.value;
      }
    });
    if (!expandedValue) return;

    // Extract hex values from original and oklch values from expanded
    HEX_PATTERN.lastIndex = 0;
    let hexMatch: RegExpExecArray | null;
    while ((hexMatch = HEX_PATTERN.exec(origValue)) !== null) {
      if (isHexInsideFunction(origValue, hexMatch.index)) continue;
      const hex = hexMatch[0];
      if (hex.toLowerCase() === "#ffffff") continue; // special case

      const origOklch = hexToOklch(hex);
      if (!origOklch) continue;
      const origParsed = parseOklchString(origOklch);
      if (!origParsed) continue;

      // Find the first oklch() in the expanded value
      const expandedOklchMatch = expandedValue.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
      if (!expandedOklchMatch) continue;
      const expandedParsed = parseOklchString(expandedOklchMatch[0]);
      if (!expandedParsed) continue;

      const dE = oklchDeltaE(origParsed, expandedParsed);
      if (dE >= threshold) {
        failures.push({
          prop: decl.prop,
          original: hex,
          expanded: expandedOklchMatch[0],
          deltaE: dE,
        });
      }
    }
  });

  return failures;
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when invoked directly (not when imported)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const validateMode = args.includes("--validate");
  const filePaths = args.filter((a) => !a.startsWith("--"));

  if (filePaths.length === 0) {
    console.error(
      "Usage: bun run scripts/convert-hex-to-cita.ts <css-file> [<css-file> ...] [--validate]",
    );
    process.exit(1);
  }

  for (const filePath of filePaths) {
    console.log(`Converting ${filePath}...`);
    const originalSource = readFileSync(filePath, "utf8");
    const convertedSource = convertCSSFile(filePath);

    if (validateMode) {
      console.log(`  Validating round-trip for ${filePath}...`);
      const failures = validateRoundTrip(originalSource, convertedSource);
      if (failures.length === 0) {
        console.log("  All conversions passed round-trip validation (delta-E < 0.01).");
      } else {
        console.warn(`  ${failures.length} conversion(s) exceeded delta-E threshold:`);
        for (const f of failures) {
          console.warn(
            `    ${f.prop}: ${f.original} → ${f.expanded} (delta-E=${f.deltaE.toFixed(4)})`,
          );
        }
      }
    }

    console.log(`  Done: ${filePath}`);
  }
}
