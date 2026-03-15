/**
 * Theme Accessibility Module — Tugways Theme Generator
 *
 * Provides WCAG 2.x contrast ratio calculation, APCA Lc calculation,
 * theme contrast validation against the authoritative pairing map,
 * automatic contrast adjustment via tone-bumping, and CVD simulation
 * using Machado et al. 2009 matrices.
 *
 * References:
 *   [D05] CVD simulation matrices (Machado et al. 2009), Table T02
 *   [D07] Contrast thresholds follow WCAG 2.x as normative, APCA as informational
 *   [D03] Authoritative fg/bg pairing map
 *   [D09] Dual output: string tokens + resolved OKLCH map
 *   Table T01: Contrast Threshold Matrix
 *   Spec S02: ThemeOutput / ResolvedColor interfaces
 *
 * @module components/tugways/theme-accessibility
 */

import { oklchToHex, oklchToLinearSRGB, DEFAULT_CANONICAL_L, L_DARK, L_LIGHT } from "./palette-engine";
import type { ResolvedColor, ContrastResult, CVDWarning } from "./theme-derivation-engine";
import type { ElementSurfacePairing } from "./element-surface-pairing-map";

// ---------------------------------------------------------------------------
// Re-export PairingEntry alias for compatibility with plan spec.
// validateThemeContrast accepts PairingEntry[] (which is ElementSurfacePairing[]).
// ---------------------------------------------------------------------------
export type { ElementSurfacePairing as PairingEntry };

// ---------------------------------------------------------------------------
// WCAG 2.x — relative luminance contrast ratio
// ---------------------------------------------------------------------------

/**
 * Convert a single linearised sRGB channel value to WCAG 2.x relative luminance.
 *
 * The WCAG 2.x formula uses gamma-decoded (linear) sRGB:
 *   Y = R_lin * 0.2126 + G_lin * 0.7152 + B_lin * 0.0722
 *
 * Channel values are [0, 1] gamma-encoded sRGB.
 */
function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Parse a 6-digit hex color string (#rrggbb) into linear sRGB {r, g, b}.
 */
function hexToLinearSRGB(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return {
    r: srgbChannelToLinear(r),
    g: srgbChannelToLinear(g),
    b: srgbChannelToLinear(b),
  };
}

/**
 * Compute WCAG 2.x relative luminance from a linear-sRGB triplet.
 *
 * Y = 0.2126R + 0.7152G + 0.0722B  (linear sRGB coefficients, IEC 61966-2-1)
 */
function relativeLuminance(linear: { r: number; g: number; b: number }): number {
  return 0.2126 * linear.r + 0.7152 * linear.g + 0.0722 * linear.b;
}

/**
 * Compute the WCAG 2.x contrast ratio between two hex colors.
 *
 * Returns the standard relative luminance ratio:
 *   (L1 + 0.05) / (L2 + 0.05)
 * where L1 >= L2 (lighter color is always in numerator).
 *
 * Range is [1, 21]. White-on-black returns exactly 21.0.
 *
 * @param fgHex - Foreground color as #rrggbb
 * @param bgHex - Background color as #rrggbb
 * @returns WCAG 2.x contrast ratio
 */
export function computeWcagContrast(fgHex: string, bgHex: string): number {
  const fgLinear = hexToLinearSRGB(fgHex);
  const bgLinear = hexToLinearSRGB(bgHex);
  const l1 = relativeLuminance(fgLinear);
  const l2 = relativeLuminance(bgLinear);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// APCA — Advanced Perceptual Contrast Algorithm (Lc value)
// ---------------------------------------------------------------------------

// APCA constants (APCA-W3 0.98G-4g)
const APCA_NORMAL_BG = 0.56;
const APCA_NORMAL_TXT = 0.57;
const APCA_REVERSE_BG = 0.65;
const APCA_REVERSE_TXT = 0.62;
const APCA_SCALE = 1.14;
const APCA_LOW_CLIP = 0.1;
const APCA_DELTA_YC_MIN = 0.0005;
const APCA_EXPONENT = 2.4;

/**
 * Compute the APCA SA98G soft-clip gamma for a linearised-sRGB channel.
 * This is the "flare" or "ambient" coefficient used in APCA.
 */
function apcaGamma(y: number): number {
  return Math.pow(Math.abs(y), APCA_EXPONENT) * Math.sign(y);
}

/**
 * Compute the APCA Y (stimulus luminance) for a hex color.
 *
 * APCA uses the same linearisation formula as WCAG 2.x but applies
 * an additional power function (SA98G exponent = 2.4) to the result.
 * The "flare" constant 0.05 is not added here — APCA handles it in the
 * soft-clip phase.
 *
 * Note: APCA uses Y = 0.2126R^2.4 + 0.7152G^2.4 + 0.0722B^2.4
 * which is equivalent to applying apcaGamma to each channel then
 * applying the standard luminance coefficients.
 */
function apcaY(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const rLin = srgbChannelToLinear(r);
  const gLin = srgbChannelToLinear(g);
  const bLin = srgbChannelToLinear(b);
  return 0.2126 * apcaGamma(rLin) + 0.7152 * apcaGamma(gLin) + 0.0722 * apcaGamma(bLin);
}

/**
 * Compute the perceptual lightness contrast (Lc, SA98G-based) for an element/surface pair.
 *
 * Returns the signed Lc value:
 *   - Positive Lc: dark text on light background (normal polarity)
 *   - Negative Lc: light text on dark background (reverse polarity)
 *
 * Magnitude (|Lc|) is the normative contrast gate per LC_THRESHOLDS:
 *   |Lc| >= 75 → body text (normal)
 *   |Lc| >= 60 → large / bold text
 *   |Lc| >= 30 → UI components / icons
 *   |Lc| >= 15 → decorative
 *
 * @param fgHex - Element (foreground) color as #rrggbb
 * @param bgHex - Surface (background) color as #rrggbb
 * @returns Signed Lc value
 */
export function computeLcContrast(fgHex: string, bgHex: string): number {
  const yTxt = apcaY(fgHex);
  const yBg = apcaY(bgHex);

  // Polarity: if bg is lighter, normal polarity (dark text on light bg)
  const isNormal = yBg > yTxt;

  let sapc: number;

  if (isNormal) {
    // Normal polarity: dark text on light background
    const yBgPow = Math.pow(yBg, APCA_NORMAL_BG);
    const yTxtPow = Math.pow(yTxt, APCA_NORMAL_TXT);
    const deltaYc = yBgPow - yTxtPow;
    // Soft-clip low contrasts
    if (Math.abs(deltaYc) < APCA_DELTA_YC_MIN) return 0;
    sapc = deltaYc < 0 ? 0 : deltaYc * APCA_SCALE;
    if (sapc < APCA_LOW_CLIP) return 0;
    return (sapc - 0.027) * 100;
  } else {
    // Reverse polarity: light text on dark background
    const yBgPow = Math.pow(yBg, APCA_REVERSE_BG);
    const yTxtPow = Math.pow(yTxt, APCA_REVERSE_TXT);
    const deltaYc = yBgPow - yTxtPow;
    // Soft-clip low contrasts
    if (Math.abs(deltaYc) < APCA_DELTA_YC_MIN) return 0;
    sapc = deltaYc > 0 ? 0 : deltaYc * APCA_SCALE;
    if (sapc > -APCA_LOW_CLIP) return 0;
    return (sapc + 0.027) * 100;
  }
}

// ---------------------------------------------------------------------------
// Contrast thresholds per Table T01
// ---------------------------------------------------------------------------

/**
 * Minimum WCAG 2.x contrast ratio per contrast role (Table T01).
 *
 *   body-text    → 4.5:1 (WCAG AA for 14px/400wt text)
 *   large-text   → 3.0:1 (WCAG AA for 18px+ / 700wt text)
 *   ui-component → 3.0:1 (WCAG AA non-text contrast)
 *   decorative   → 1.0   (no minimum)
 */
export const WCAG_CONTRAST_THRESHOLDS: Record<string, number> = {
  "body-text": 4.5,
  "large-text": 3.0,
  "ui-component": 3.0,
  decorative: 1.0,
};

// ---------------------------------------------------------------------------
// validateThemeContrast
// ---------------------------------------------------------------------------

/**
 * Validate all element/surface pairings for a derived theme.
 *
 * Converts each resolved OKLCH color to hex via `oklchToHex()`, then checks
 * WCAG 2.x contrast ratio (informational) and perceptual lightness contrast (Lc,
 * normative) for each entry in the pairing map.
 *
 * Pairs where either the element or surface token is absent from `resolved` (e.g.,
 * non-chromatic tokens like shadows, disabled-opacity) are skipped [D09].
 *
 * @param resolved - OKLCH map from `deriveTheme()` output [D09]
 * @param pairingMap - Authoritative element/surface pairing list (typically ELEMENT_SURFACE_PAIRING_MAP)
 * @returns Array of ContrastResult entries for all evaluated pairs
 */
export function validateThemeContrast(
  resolved: Record<string, ResolvedColor>,
  pairingMap: ElementSurfacePairing[],
): ContrastResult[] {
  const results: ContrastResult[] = [];

  for (const pairing of pairingMap) {
    const fgColor = resolved[pairing.element];
    const bgColor = resolved[pairing.surface];

    // Skip pairs where either token is not in the resolved map
    if (!fgColor || !bgColor) continue;

    const fgHex = oklchToHex(fgColor.L, fgColor.C, fgColor.h);
    const bgHex = oklchToHex(bgColor.L, bgColor.C, bgColor.h);

    const wcagRatio = computeWcagContrast(fgHex, bgHex);
    const lc = computeLcContrast(fgHex, bgHex);

    const lcThreshold = LC_THRESHOLDS[pairing.role] ?? 15;
    const lcPass = Math.abs(lc) >= lcThreshold;

    results.push({
      fg: pairing.element,
      bg: pairing.surface,
      wcagRatio,
      lc,
      lcPass,
      role: pairing.role,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// autoAdjustContrast — tone-bump strategy
// ---------------------------------------------------------------------------

/**
 * Compute the tone (0-100) from an OKLCH lightness value and hue name.
 *
 * Inverts the piecewise tone→L formula used by the derivation engine:
 *   if L <= canonL: tone = 50 * (L - L_DARK) / (canonL - L_DARK)
 *   else:           tone = 50 + 50 * (L - canonL) / (L_LIGHT - canonL)
 */
function lToTone(L: number, hueName: string): number {
  const canonL = DEFAULT_CANONICAL_L[hueName] ?? 0.77;
  let tone: number;
  if (L <= canonL) {
    tone = (50 * (L - L_DARK)) / (canonL - L_DARK);
  } else {
    tone = 50 + (50 * (L - canonL)) / (L_LIGHT - canonL);
  }
  return Math.max(0, Math.min(100, tone));
}

/**
 * Compute the OKLCH lightness from a tone value and hue name.
 *
 * Forward formula matching the derivation engine's resolveOklch():
 *   L = L_DARK + min(tone,50)*(canonL-L_DARK)/50 + max(tone-50,0)*(L_LIGHT-canonL)/50
 */
function toneToL(tone: number, hueName: string): number {
  const canonL = DEFAULT_CANONICAL_L[hueName] ?? 0.77;
  return (
    L_DARK +
    (Math.min(tone, 50) * (canonL - L_DARK)) / 50 +
    (Math.max(tone - 50, 0) * (L_LIGHT - canonL)) / 50
  );
}

/**
 * Parsed components of a --tug-color() token string.
 */
interface ParsedTugColor {
  /** Hue reference as-is from the token: bare name, name+offset, or preset stem */
  hueRef: string;
  /** Intensity (0-100), defaulting to 50 for canonical or preset forms */
  intensity: number;
  /** Tone (0-100), defaulting to 50 for canonical, or preset-specific value */
  tone: number;
}

/**
 * Preset parameter values for the four named presets.
 */
const PRESET_PARAMS: Record<string, { intensity: number; tone: number }> = {
  light: { intensity: 20, tone: 85 },
  dark: { intensity: 50, tone: 20 },
  intense: { intensity: 90, tone: 50 },
  muted: { intensity: 20, tone: 50 },
};

/**
 * Parse a --tug-color() token string into its hue reference, intensity, and tone.
 *
 * Handles all compact forms produced by the derivation engine:
 *   --tug-color(violet)              → hueRef=violet, i=50, t=50
 *   --tug-color(cobalt+6)            → hueRef=cobalt+6, i=50, t=50
 *   --tug-color(violet-light)        → hueRef=violet, i=20, t=85
 *   --tug-color(violet, i: 10, t: 60)→ hueRef=violet, i=10, t=60
 *   --tug-color(cobalt+6, t: 80)     → hueRef=cobalt+6, i=50, t=80
 *
 * Returns null if the string is not a recognised --tug-color() form (e.g.
 * transparent, none, plain var() references).
 */
function parseTugColorToken(token: string): ParsedTugColor | null {
  const inner = token.match(/^--tug-color\((.+)\)$/);
  if (!inner) return null;

  const body = inner[1].trim();

  // Split on the first comma to separate hue reference from parameter list
  const commaIdx = body.indexOf(",");
  const hueStr = commaIdx === -1 ? body : body.slice(0, commaIdx).trim();
  const paramStr = commaIdx === -1 ? "" : body.slice(commaIdx + 1).trim();

  // Check for preset suffix on bare hue names (no offset)
  // A hue name is letters only; a preset suffix follows a hyphen: hue-preset
  // Offset forms contain + or digits after letters (e.g. cobalt+6, violet-6)
  // We distinguish "violet-light" (preset) from "violet-6" (offset) by checking
  // whether the suffix after the last hyphen is a known preset keyword.
  const presetMatch = hueStr.match(/^([a-z]+)-(light|dark|intense|muted)$/);
  if (presetMatch && commaIdx === -1) {
    const stem = presetMatch[1];
    const preset = presetMatch[2];
    const { intensity, tone } = PRESET_PARAMS[preset];
    return { hueRef: stem, intensity, tone };
  }

  // Parse optional i: N and t: N parameters
  let intensity = 50;
  let tone = 50;

  if (paramStr) {
    const iMatch = paramStr.match(/\bi:\s*(\d+)/);
    const tMatch = paramStr.match(/\bt:\s*(\d+)/);
    if (iMatch) intensity = parseInt(iMatch[1], 10);
    if (tMatch) tone = parseInt(tMatch[1], 10);
  }

  return { hueRef: hueStr, intensity, tone };
}

/**
 * Rebuild a --tug-color() token string for the given hue reference, intensity, and tone.
 *
 * Preserves the hue reference exactly as-is (including any +N or -N offset),
 * only changing the tone parameter. Uses compact form rules:
 *   - Canonical (i=50, t=50): --tug-color(hue)
 *   - Preset match (bare hue name only): --tug-color(hue-preset)
 *   - Full form: --tug-color(hue, i: N, t: N)
 */
function rebuildTugColorToken(hueRef: string, intensity: number, tone: number): string {
  const ri = Math.round(intensity);
  const rt = Math.round(tone);

  if (ri === 50 && rt === 50) return `--tug-color(${hueRef})`;

  // Preset shortcuts only apply when hueRef is a bare name (no + or digit-after-hyphen offset)
  const hasOffset = hueRef.includes("+") || /[a-z]-\d/.test(hueRef);
  if (!hasOffset) {
    if (ri === 20 && rt === 85) return `--tug-color(${hueRef}-light)`;
    if (ri === 50 && rt === 20) return `--tug-color(${hueRef}-dark)`;
    if (ri === 90 && rt === 50) return `--tug-color(${hueRef}-intense)`;
    if (ri === 20 && rt === 50) return `--tug-color(${hueRef}-muted)`;
  }

  const parts: string[] = [];
  if (ri !== 50) parts.push(`i: ${ri}`);
  if (rt !== 50) parts.push(`t: ${rt}`);

  if (parts.length === 0) return `--tug-color(${hueRef})`;
  return `--tug-color(${hueRef}, ${parts.join(", ")})`;
}

/**
 * Resolve the base hue name from a hue reference string.
 *
 * For bare names like "violet" returns "violet".
 * For offset forms like "cobalt+6" or "violet-6" returns "cobalt" / "violet".
 * Falls back to "violet" if no match found.
 */
function baseHueName(hueRef: string): string {
  // Strip + or - offset to recover the base name
  const bare = hueRef.split(/[+-]/)[0];
  return (bare in DEFAULT_CANONICAL_L) ? bare : "violet";
}

/**
 * Automatically adjust element token tones to satisfy Lc contrast thresholds.
 *
 * Strategy per plan spec:
 *   1. Group failures by element (fg) token.
 *   2. For each element token, identify the most restrictive surface (darkest surface in
 *      dark mode, lightest surface in light mode).
 *   3. Bump element tone in the direction that increases contrast against the most
 *      restrictive surface. Satisfying the worst-case pair guarantees all other pairings
 *      for the same element token also pass.
 *   4. Apply a maximum of 3 iterations to handle secondary effects.
 *   5. Tokens that still fail after 3 iterations are added to `unfixable`.
 *
 * Only element (fg) tokens are adjusted. Surface token adjustment is deferred [D09].
 *
 * @param tokens - Token string map from deriveTheme() (--tug-color() strings)
 * @param resolved - Resolved OKLCH map from deriveTheme() [D09]
 * @param failures - ContrastResult entries where lcPass is false
 * @returns Updated tokens and resolved maps, plus list of unfixable token names
 */
export function autoAdjustContrast(
  tokens: Record<string, string>,
  resolved: Record<string, ResolvedColor>,
  failures: ContrastResult[],
): {
  tokens: Record<string, string>;
  resolved: Record<string, ResolvedColor>;
  unfixable: string[];
} {
  // Work on mutable copies
  const updatedTokens: Record<string, string> = { ...tokens };
  const updatedResolved: Record<string, ResolvedColor> = { ...resolved };

  const MAX_ITERATIONS = 3;
  // Tone step per bump — 5 tone units, re-evaluated each iteration
  const TONE_STEP = 5;

  let remainingFailures = failures.filter((f) => !f.lcPass);
  const unfixable: string[] = [];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (remainingFailures.length === 0) break;

    // Group remaining failures by element token
    const byElement = new Map<string, ContrastResult[]>();
    for (const failure of remainingFailures) {
      const list = byElement.get(failure.fg) ?? [];
      list.push(failure);
      byElement.set(failure.fg, list);
    }

    // For each element token, find the most restrictive surface and bump element tone
    for (const [elementToken, elementFailures] of byElement) {
      const elementColor = updatedResolved[elementToken];
      if (!elementColor) continue;

      // Determine if element is "dark" (low lightness) or "light" (high lightness)
      // to pick the right direction to bump.
      // In dark mode: element is typically light (high L); bump L upward to increase contrast
      // In light mode: element is typically dark (low L); bump L downward to increase contrast
      // Heuristic: compare element L to the surface Ls. Element is "dark relative to surfaces"
      // if element.L < surface.L.

      // Find the most restrictive surface (the one where contrast delta is worst).
      // "Most restrictive" = surface that is closest in luminance to element.
      let worstSurfaceColor: ResolvedColor | null = null;
      let worstContrast = Infinity;
      for (const failure of elementFailures) {
        const surfaceColor = updatedResolved[failure.bg];
        if (!surfaceColor) continue;
        const elementHex = oklchToHex(elementColor.L, elementColor.C, elementColor.h);
        const surfaceHex = oklchToHex(surfaceColor.L, surfaceColor.C, surfaceColor.h);
        const ratio = computeWcagContrast(elementHex, surfaceHex);
        if (ratio < worstContrast) {
          worstContrast = ratio;
          worstSurfaceColor = surfaceColor;
        }
      }

      if (!worstSurfaceColor) continue;

      // Determine bump direction: move element L away from surface L
      const elementL = elementColor.L;
      const surfaceL = worstSurfaceColor.L;
      const bumpDirection = elementL >= surfaceL ? 1 : -1; // positive = lighter, negative = darker

      // Parse the original --tug-color() string to extract hue reference and intensity.
      // This preserves hue+offset forms (e.g. "cobalt+6") exactly, avoiding the
      // oklchToTugColor() hue-recovery path which loses offsets >5° from named hues.
      const originalTokenStr = updatedTokens[elementToken];
      const parsed = parseTugColorToken(originalTokenStr);
      if (!parsed) continue;

      const { hueRef, intensity } = parsed;
      const hueName = baseHueName(hueRef);
      const currentTone = lToTone(elementL, hueName);
      const newTone = Math.max(0, Math.min(100, currentTone + bumpDirection * TONE_STEP));
      const newL = toneToL(newTone, hueName);

      const newResolved: ResolvedColor = { ...elementColor, L: newL };
      const newTokenStr = rebuildTugColorToken(hueRef, intensity, newTone);

      updatedResolved[elementToken] = newResolved;
      updatedTokens[elementToken] = newTokenStr;
    }

    // Re-evaluate remaining failures using Lc (normative gate)
    const stillFailing: ContrastResult[] = [];
    for (const failure of remainingFailures) {
      const elementColor = updatedResolved[failure.fg];
      const surfaceColor = updatedResolved[failure.bg];
      if (!elementColor || !surfaceColor) continue;
      const elementHex = oklchToHex(elementColor.L, elementColor.C, elementColor.h);
      const surfaceHex = oklchToHex(surfaceColor.L, surfaceColor.C, surfaceColor.h);
      const newWcagRatio = computeWcagContrast(elementHex, surfaceHex);
      const newLc = computeLcContrast(elementHex, surfaceHex);
      const lcThreshold = LC_THRESHOLDS[failure.role] ?? 15;
      if (Math.abs(newLc) < lcThreshold) {
        stillFailing.push({ ...failure, wcagRatio: newWcagRatio, lc: newLc, lcPass: false });
      }
    }
    remainingFailures = stillFailing;
  }

  // Any pairs still failing after MAX_ITERATIONS → unfixable
  const unfixableElementTokens = new Set<string>();
  for (const failure of remainingFailures) {
    unfixableElementTokens.add(failure.fg);
  }
  unfixable.push(...Array.from(unfixableElementTokens));

  return {
    tokens: updatedTokens,
    resolved: updatedResolved,
    unfixable,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers re-exported for testing
// ---------------------------------------------------------------------------

/**
 * Compute L value from tone and hue name (exported for testing).
 * @internal
 */
export function _toneToL(tone: number, hueName: string): number {
  return toneToL(tone, hueName);
}

/**
 * Compute tone from L value and hue name (exported for testing).
 * @internal
 */
export function _lToTone(L: number, hueName: string): number {
  return lToTone(L, hueName);
}

// ---------------------------------------------------------------------------
// CVD types
// ---------------------------------------------------------------------------

/** Color vision deficiency simulation type. */
export type CVDType = "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";

// ---------------------------------------------------------------------------
// CVD simulation — Machado et al. 2009 matrices (Table T02)
// ---------------------------------------------------------------------------

/**
 * A 3×3 matrix stored in row-major order: [row0, row1, row2]
 * where each row is [col0, col1, col2].
 */
type Matrix3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

/**
 * CVD simulation matrices at severity=1.0 from Machado et al. 2009.
 *
 * Applied in linear sRGB space. Each matrix maps [R, G, B] input to a
 * simulated [R', G', B'] that approximates how a person with the given
 * deficiency would perceive the colour.
 *
 * Source: Table T02 in the plan / Machado, Oliveira & Fernandes (2009)
 * "A Physiologically-based Model for Simulation of Color Vision Deficiency".
 */
export const CVD_MATRICES: Record<CVDType, Matrix3x3> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.011820, 0.042940, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.303900],
  ],
  achromatopsia: [
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
  ],
};

/**
 * Apply a 3×3 matrix to a linear-sRGB triplet.
 */
function applyMatrix3x3(
  m: Matrix3x3,
  rgb: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  return {
    r: m[0][0] * rgb.r + m[0][1] * rgb.g + m[0][2] * rgb.b,
    g: m[1][0] * rgb.r + m[1][1] * rgb.g + m[1][2] * rgb.b,
    b: m[2][0] * rgb.r + m[2][1] * rgb.g + m[2][2] * rgb.b,
  };
}

/**
 * Simulate colour vision deficiency by applying a Machado et al. 2009
 * matrix to a linear-sRGB triplet.
 *
 * The `severity` parameter (0.0–1.0, default 1.0) interpolates between the
 * identity (severity=0, input unchanged) and the full deficiency matrix
 * (severity=1). Values outside [0, 1] are clamped.
 *
 * Output channels are clamped to [0, 1] after the matrix multiplication.
 *
 * @param linearRGB - Input colour in linear sRGB {r, g, b} ∈ [0, 1]
 * @param type      - CVD type from CVDType
 * @param severity  - Simulation severity, 0.0–1.0 (default 1.0)
 * @returns Simulated linear sRGB {r, g, b}, clamped to [0, 1]
 */
export function simulateCVD(
  linearRGB: { r: number; g: number; b: number },
  type: CVDType,
  severity = 1.0,
): { r: number; g: number; b: number } {
  const s = Math.max(0, Math.min(1, severity));
  const matrix = CVD_MATRICES[type];
  const transformed = applyMatrix3x3(matrix, linearRGB);

  // Interpolate between input (s=0) and full simulation (s=1)
  const r = (1 - s) * linearRGB.r + s * transformed.r;
  const g = (1 - s) * linearRGB.g + s * transformed.g;
  const b = (1 - s) * linearRGB.b + s * transformed.b;

  return {
    r: Math.max(0, Math.min(1, r)),
    g: Math.max(0, Math.min(1, g)),
    b: Math.max(0, Math.min(1, b)),
  };
}

/**
 * Simulate colour vision deficiency for an OKLCH colour.
 *
 * Primary entry point for the theme pipeline per [D09]: accepts resolved
 * OKLCH values directly from `deriveTheme().resolved`, converts to linear
 * sRGB via `oklchToLinearSRGB()`, applies the CVD matrix, and returns
 * simulated linear sRGB clamped to [0, 1].
 *
 * @param L        - OKLCH lightness
 * @param C        - OKLCH chroma
 * @param h        - OKLCH hue angle (degrees)
 * @param type     - CVD type
 * @param severity - Simulation severity, 0.0–1.0 (default 1.0)
 * @returns Simulated linear sRGB {r, g, b}, clamped to [0, 1]
 */
export function simulateCVDFromOKLCH(
  L: number,
  C: number,
  h: number,
  type: CVDType,
  severity = 1.0,
): { r: number; g: number; b: number } {
  const linearRGB = oklchToLinearSRGB(L, C, h);
  return simulateCVD(linearRGB, type, severity);
}

/**
 * Apply sRGB gamma encoding (IEC 61966-2-1) to a single linear channel.
 */
function linearToSrgbGamma(c: number): number {
  return c >= 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
}

/**
 * Simulate colour vision deficiency for a hex colour and return the result
 * as a hex string.
 *
 * Convenience wrapper for standalone use outside the theme pipeline:
 *   hex → linearise sRGB → apply CVD matrix → gamma-encode → hex
 *
 * @param hex      - Input colour as #rrggbb
 * @param type     - CVD type
 * @param severity - Simulation severity, 0.0–1.0 (default 1.0)
 * @returns Simulated colour as #rrggbb
 */
export function simulateCVDForHex(
  hex: string,
  type: CVDType,
  severity = 1.0,
): string {
  // hex → gamma-decoded linear sRGB
  const rGamma = parseInt(hex.slice(1, 3), 16) / 255;
  const gGamma = parseInt(hex.slice(3, 5), 16) / 255;
  const bGamma = parseInt(hex.slice(5, 7), 16) / 255;
  const linearRGB = {
    r: srgbChannelToLinear(rGamma),
    g: srgbChannelToLinear(gGamma),
    b: srgbChannelToLinear(bGamma),
  };

  // Apply CVD matrix
  const simLinear = simulateCVD(linearRGB, type, severity);

  // Gamma-encode and convert to hex
  const rOut = Math.round(Math.max(0, Math.min(1, linearToSrgbGamma(simLinear.r))) * 255);
  const gOut = Math.round(Math.max(0, Math.min(1, linearToSrgbGamma(simLinear.g))) * 255);
  const bOut = Math.round(Math.max(0, Math.min(1, linearToSrgbGamma(simLinear.b))) * 255);

  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(rOut)}${toHex(gOut)}${toHex(bOut)}`;
}

// ---------------------------------------------------------------------------
// CVD distinguishability check
// ---------------------------------------------------------------------------

/**
 * Minimum lightness delta (in simulated linear sRGB space) below which a
 * semantic token pair is considered indistinguishable under a given CVD type.
 *
 * Computed as |Y1 - Y2| where Y = 0.2126R + 0.7152G + 0.0722B
 * on the simulated linear-sRGB outputs.
 *
 * A delta below this threshold means the two colours appear nearly the same
 * lightness to a person with that deficiency, making them hard to distinguish
 * even if their hues differ in normal vision.
 */
const CVD_LIGHTNESS_DELTA_THRESHOLD = 0.05;

/**
 * The four CVD types enumerated for iteration.
 */
const ALL_CVD_TYPES: CVDType[] = [
  "protanopia",
  "deuteranopia",
  "tritanopia",
  "achromatopsia",
];

/**
 * Authoritative semantic token pairs to check for CVD distinguishability.
 *
 * Each pair [tokenA, tokenB] represents two colours that convey different
 * semantic meaning and must remain visually distinguishable under CVD.
 *
 * Pairs are defined as [positive/warning, positive/destructive, primary/destructive,
 * accent/atmosphere] following the plan spec.
 */
export const CVD_SEMANTIC_PAIRS: [string, string][] = [
  // Status signals: success (green-family) vs caution (yellow-family)
  ["--tug-base-tone-success", "--tug-base-tone-caution"],
  // Status signals: success (green) vs danger/destructive (red-family)
  ["--tug-base-tone-success", "--tug-base-tone-danger"],
  // Primary action vs destructive action (button colours)
  ["--tug-base-accent-default", "--tug-base-tone-danger"],
  // Accent vs atmosphere (theme identity colours)
  ["--tug-base-accent-default", "--tug-base-bg-app"],
];

/**
 * Check whether semantic token pairs remain distinguishable under each CVD type.
 *
 * Consumes the resolved OKLCH map from `deriveTheme()` per [D09].
 * For each CVD type, simulates both tokens in a pair via `simulateCVDFromOKLCH`
 * and measures the luminance delta of the simulated outputs.
 *
 * A warning is emitted if the luminance delta drops below
 * `CVD_LIGHTNESS_DELTA_THRESHOLD` (0.05), indicating the pair becomes
 * difficult to distinguish.
 *
 * Pairs where either token is absent from the resolved map are silently skipped.
 *
 * @param resolved      - OKLCH map from `deriveTheme()` output [D09]
 * @param semanticPairs - Array of [tokenA, tokenB] pairs to evaluate
 * @returns Array of CVDWarning entries for indistinguishable pairs
 */
export function checkCVDDistinguishability(
  resolved: Record<string, ResolvedColor>,
  semanticPairs: [string, string][],
): CVDWarning[] {
  const warnings: CVDWarning[] = [];

  for (const cvdType of ALL_CVD_TYPES) {
    for (const [tokenA, tokenB] of semanticPairs) {
      const colorA = resolved[tokenA];
      const colorB = resolved[tokenB];

      // Skip pairs where either token is absent (non-chromatic / structural)
      if (!colorA || !colorB) continue;

      // Simulate both colours under the current CVD type
      const simA = simulateCVDFromOKLCH(colorA.L, colorA.C, colorA.h, cvdType);
      const simB = simulateCVDFromOKLCH(colorB.L, colorB.C, colorB.h, cvdType);

      // Compute luminance of each simulated colour (WCAG relative luminance formula)
      const lumA = 0.2126 * simA.r + 0.7152 * simA.g + 0.0722 * simA.b;
      const lumB = 0.2126 * simB.r + 0.7152 * simB.g + 0.0722 * simB.b;
      const delta = Math.abs(lumA - lumB);

      if (delta < CVD_LIGHTNESS_DELTA_THRESHOLD) {
        warnings.push({
          type: cvdType,
          tokenPair: [tokenA, tokenB],
          description:
            `Under ${cvdType}, "${tokenA}" and "${tokenB}" have a simulated ` +
            `luminance delta of ${delta.toFixed(4)}, below the threshold of ` +
            `${CVD_LIGHTNESS_DELTA_THRESHOLD}. They may appear indistinguishable.`,
          suggestion:
            `Increase lightness separation between the two tokens, or choose ` +
            `hues that remain distinguishable under ${cvdType} simulation.`,
        });
      }
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Utility: oklchToHex re-export for consumers of this module
// ---------------------------------------------------------------------------

export { oklchToHex } from "./palette-engine";
export type { ResolvedColor, ContrastResult, CVDWarning } from "./theme-derivation-engine";

// ---------------------------------------------------------------------------
// Lc contrast thresholds (normative) and WCAG ratio thresholds (informational)
// ---------------------------------------------------------------------------

/**
 * Minimum perceptual lightness contrast (|Lc|) per role — normative gate [D06].
 *
 * Per SA98G / APCA guidance, adjusted for design system quality bar:
 *   body-text    → 75
 *   large-text   → 60  (stricter than APCA default 45 — intentional quality bar)
 *   ui-component → 30
 *   decorative   → 15
 */
export const LC_THRESHOLDS: Record<string, number> = {
  "body-text": 75,
  "large-text": 60,
  "ui-component": 30,
  decorative: 15,
};

/**
 * Near-pass band for marginal badge classification (fixed 5 Lc units, per Spec S04).
 * A result with |Lc| >= (LC_THRESHOLDS[role] - LC_MARGINAL_DELTA) is classified as
 * "marginal" rather than "fail".
 */
export const LC_MARGINAL_DELTA = 5;
