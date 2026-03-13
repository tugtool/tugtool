/**
 * Theme Accessibility Module — Tugways Theme Generator
 *
 * Provides WCAG 2.x contrast ratio calculation, APCA Lc calculation,
 * theme contrast validation against the authoritative pairing map,
 * and automatic contrast adjustment via tone-bumping.
 *
 * References:
 *   [D07] Contrast thresholds follow WCAG 2.x as normative, APCA as informational
 *   [D03] Authoritative fg/bg pairing map
 *   [D09] Dual output: string tokens + resolved OKLCH map
 *   Table T01: Contrast Threshold Matrix
 *   Spec S02: ThemeOutput / ResolvedColor interfaces
 *
 * @module components/tugways/theme-accessibility
 */

import { oklchToHex, DEFAULT_CANONICAL_L, L_DARK, L_LIGHT } from "./palette-engine";
import type { ResolvedColor, ContrastResult } from "./theme-derivation-engine";
import type { FgBgPairing } from "./fg-bg-pairing-map";

// ---------------------------------------------------------------------------
// Re-export PairingEntry alias for compatibility with plan spec.
// validateThemeContrast accepts PairingEntry[] (which is FgBgPairing[]).
// ---------------------------------------------------------------------------
export type { FgBgPairing as PairingEntry };

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
 * Compute the APCA Lc (lightness contrast) value for a fg/bg pair.
 *
 * Returns the signed Lc value:
 *   - Positive Lc: dark text on light background (normal polarity)
 *   - Negative Lc: light text on dark background (reverse polarity)
 *
 * Magnitude (|Lc|) indicates perceptual contrast. Per APCA guidance:
 *   |Lc| >= 75 → body text (normal)
 *   |Lc| >= 45 → large / bold text
 *   |Lc| >= 30 → UI components / icons
 *   |Lc| >= 15 → decorative
 *
 * @param fgHex - Foreground color as #rrggbb
 * @param bgHex - Background color as #rrggbb
 * @returns Signed APCA Lc value
 */
export function computeApcaLc(fgHex: string, bgHex: string): number {
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
 * Validate all fg/bg pairings for a derived theme.
 *
 * Converts each resolved OKLCH color to hex via `oklchToHex()`, then checks
 * WCAG 2.x contrast ratio and APCA Lc for each entry in the pairing map.
 *
 * Pairs where either the fg or bg token is absent from `resolved` (e.g.,
 * non-chromatic tokens like shadows, disabled-opacity) are skipped [D09].
 *
 * @param resolved - OKLCH map from `deriveTheme()` output [D09]
 * @param pairingMap - Authoritative fg/bg pairing list (typically FG_BG_PAIRING_MAP)
 * @returns Array of ContrastResult entries for all evaluated pairs
 */
export function validateThemeContrast(
  resolved: Record<string, ResolvedColor>,
  pairingMap: FgBgPairing[],
): ContrastResult[] {
  const results: ContrastResult[] = [];

  for (const pairing of pairingMap) {
    const fgColor = resolved[pairing.fg];
    const bgColor = resolved[pairing.bg];

    // Skip pairs where either token is not in the resolved map
    if (!fgColor || !bgColor) continue;

    const fgHex = oklchToHex(fgColor.L, fgColor.C, fgColor.h);
    const bgHex = oklchToHex(bgColor.L, bgColor.C, bgColor.h);

    const wcagRatio = computeWcagContrast(fgHex, bgHex);
    const apcaLc = computeApcaLc(fgHex, bgHex);

    const threshold = WCAG_CONTRAST_THRESHOLDS[pairing.role] ?? 1.0;
    const wcagPass = wcagRatio >= threshold;

    results.push({
      fg: pairing.fg,
      bg: pairing.bg,
      wcagRatio,
      apcaLc,
      wcagPass,
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
 * Compute a new ResolvedColor by bumping the lightness of an existing resolved
 * OKLCH color by `deltaL` (clamped to [0, 1]).
 */
function bumpResolvedL(color: ResolvedColor, deltaL: number): ResolvedColor {
  const newL = Math.max(0, Math.min(1, color.L + deltaL));
  return { ...color, L: newL };
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
 * Automatically adjust foreground token tones to satisfy WCAG 2.x contrast thresholds.
 *
 * Strategy per plan spec:
 *   1. Group failures by fg token.
 *   2. For each fg token, identify the most restrictive background (darkest bg in
 *      dark mode, lightest bg in light mode).
 *   3. Bump fg tone in the direction that increases contrast against the most
 *      restrictive bg. Satisfying the worst-case pair guarantees all other pairings
 *      for the same fg token also pass.
 *   4. Apply a maximum of 3 iterations to handle secondary effects.
 *   5. Tokens that still fail after 3 iterations are added to `unfixable`.
 *
 * Only fg tokens are adjusted. Background token adjustment is deferred [D09].
 *
 * @param tokens - Token string map from deriveTheme() (--tug-color() strings)
 * @param resolved - Resolved OKLCH map from deriveTheme() [D09]
 * @param failures - ContrastResult entries where wcagPass is false
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

  let remainingFailures = failures.filter((f) => !f.wcagPass);
  const unfixable: string[] = [];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (remainingFailures.length === 0) break;

    // Group remaining failures by fg token
    const byFg = new Map<string, ContrastResult[]>();
    for (const failure of remainingFailures) {
      const list = byFg.get(failure.fg) ?? [];
      list.push(failure);
      byFg.set(failure.fg, list);
    }

    // For each fg token, find the most restrictive bg and bump fg tone
    for (const [fgToken, fgFailures] of byFg) {
      const fgColor = updatedResolved[fgToken];
      if (!fgColor) continue;

      // Determine if fg is "dark" (low lightness) or "light" (high lightness)
      // to pick the right direction to bump.
      // In dark mode: fg is typically light (high L); bump L upward to increase contrast
      // In light mode: fg is typically dark (low L); bump L downward to increase contrast
      // Heuristic: compare fg L to the bg Ls. Fg is "dark relative to bgs" if fg.L < bg.L.

      // Find the most restrictive bg (the one where contrast delta is worst).
      // "Most restrictive" = bg that is closest in luminance to fg.
      let worstBgColor: ResolvedColor | null = null;
      let worstContrast = Infinity;
      for (const failure of fgFailures) {
        const bgColor = updatedResolved[failure.bg];
        if (!bgColor) continue;
        const fgHex = oklchToHex(fgColor.L, fgColor.C, fgColor.h);
        const bgHex = oklchToHex(bgColor.L, bgColor.C, bgColor.h);
        const ratio = computeWcagContrast(fgHex, bgHex);
        if (ratio < worstContrast) {
          worstContrast = ratio;
          worstBgColor = bgColor;
        }
      }

      if (!worstBgColor) continue;

      // Determine bump direction: move fg L away from bg L
      const fgL = fgColor.L;
      const bgL = worstBgColor.L;
      const bumpDirection = fgL >= bgL ? 1 : -1; // positive = lighter, negative = darker

      // Parse the original --tug-color() string to extract hue reference and intensity.
      // This preserves hue+offset forms (e.g. "cobalt+6") exactly, avoiding the
      // oklchToTugColor() hue-recovery path which loses offsets >5° from named hues.
      const originalTokenStr = updatedTokens[fgToken];
      const parsed = parseTugColorToken(originalTokenStr);
      if (!parsed) continue;

      const { hueRef, intensity } = parsed;
      const hueName = baseHueName(hueRef);
      const currentTone = lToTone(fgL, hueName);
      const newTone = Math.max(0, Math.min(100, currentTone + bumpDirection * TONE_STEP));
      const newL = toneToL(newTone, hueName);

      const newResolved: ResolvedColor = { ...fgColor, L: newL };
      const newTokenStr = rebuildTugColorToken(hueRef, intensity, newTone);

      updatedResolved[fgToken] = newResolved;
      updatedTokens[fgToken] = newTokenStr;
    }

    // Re-evaluate remaining failures
    const stillFailing: ContrastResult[] = [];
    for (const failure of remainingFailures) {
      const fgColor = updatedResolved[failure.fg];
      const bgColor = updatedResolved[failure.bg];
      if (!fgColor || !bgColor) continue;
      const fgHex = oklchToHex(fgColor.L, fgColor.C, fgColor.h);
      const bgHex = oklchToHex(bgColor.L, bgColor.C, bgColor.h);
      const ratio = computeWcagContrast(fgHex, bgHex);
      const threshold = WCAG_CONTRAST_THRESHOLDS[failure.role] ?? 1.0;
      if (ratio < threshold) {
        stillFailing.push({ ...failure, wcagRatio: ratio });
      }
    }
    remainingFailures = stillFailing;
  }

  // Any pairs still failing after MAX_ITERATIONS → unfixable
  const unfixableFgTokens = new Set<string>();
  for (const failure of remainingFailures) {
    unfixableFgTokens.add(failure.fg);
  }
  unfixable.push(...Array.from(unfixableFgTokens));

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
// CVD types — re-exported here for use by the CVD module (Step 5)
// ---------------------------------------------------------------------------

export type CVDType = "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";

// ---------------------------------------------------------------------------
// Utility: oklchToHex re-export for consumers of this module
// ---------------------------------------------------------------------------

export { oklchToHex } from "./palette-engine";
export type { ResolvedColor, ContrastResult } from "./theme-derivation-engine";

// ---------------------------------------------------------------------------
// Expose WCAG_APCA_THRESHOLDS for informational display [D07]
// ---------------------------------------------------------------------------

/**
 * Minimum APCA |Lc| per contrast role (informational only, per [D07]).
 *
 *   body-text    → 75
 *   large-text   → 45
 *   ui-component → 30
 *   decorative   → 15
 */
export const APCA_LC_THRESHOLDS: Record<string, number> = {
  "body-text": 75,
  "large-text": 45,
  "ui-component": 30,
  decorative: 15,
};
