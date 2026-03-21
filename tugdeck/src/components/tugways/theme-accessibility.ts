/**
 * Theme Accessibility Module — Tugways Theme Generator
 *
 * Provides WCAG 2.x contrast ratio calculation, perceptual contrast calculation,
 * theme contrast validation against the authoritative pairing map,
 * automatic contrast adjustment via tone-bumping, and CVD simulation
 * using Machado et al. 2009 matrices.
 *
 * References:
 *   [D05] CVD simulation matrices (Machado et al. 2009), Table T02
 *   [D07] Contrast thresholds follow WCAG 2.x as normative, perceptual contrast as informational
 *   [D03] Authoritative fg/bg pairing map
 *   [D09] Dual output: string tokens + resolved OKLCH map
 *   Table T01: Contrast Threshold Matrix
 *   Spec S02: ThemeOutput / ResolvedColor interfaces
 *
 * @module components/tugways/theme-accessibility
 */

import { oklchToHex, oklchToLinearSRGB, DEFAULT_CANONICAL_L, L_DARK, L_LIGHT } from "./palette-engine";
import type { ResolvedColor, ContrastResult, CVDWarning } from "./theme-engine";
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
// OKLab L conversion
// ---------------------------------------------------------------------------

/**
 * Convert a #rrggbb hex color to OKLab perceptual lightness (L).
 *
 * Follows the OKLab specification by Björn Ottosson (2020):
 *   https://bottosson.github.io/posts/oklab/
 *
 * Steps:
 *   1. Parse hex to sRGB [0,1] channels
 *   2. Linearise each channel via srgbChannelToLinear (IEC 61966-2-1)
 *   3. Apply the OKLab M1 matrix (linear sRGB → linear LMS):
 *        l = 0.4122214708·R + 0.5363325363·G + 0.0514459929·B
 *        m = 0.2119034982·R + 0.6806995451·G + 0.1073969566·B
 *        s = 0.0883024619·R + 0.2817188376·G + 0.6299787005·B
 *   4. Cube-root each: l_ = cbrt(l), m_ = cbrt(m), s_ = cbrt(s)
 *   5. Compute L = 0.2104542553·l_ + 0.7936177850·m_ - 0.0040720468·s_
 *
 * Returns the OKLab L component in the range [0, 1]:
 *   black (#000000) → ~0.0
 *   white (#ffffff) → ~1.0
 *   mid-gray (#777777) → ~0.57
 *
 * @param hex - Color as #rrggbb hex string
 * @returns OKLab perceptual lightness L ∈ [0, 1]
 */
export function hexToOkLabL(hex: string): number {
  const r = srgbChannelToLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbChannelToLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbChannelToLinear(parseInt(hex.slice(5, 7), 16) / 255);

  // OKLab M1 matrix: linear sRGB → linear LMS (Ottosson 2020)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  // Cube-root each LMS channel
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  // OKLab M2 matrix: LMS^ → Lab (L component only)
  return 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
}

// ---------------------------------------------------------------------------
// Perceptual contrast calculation — OKLab L-based metric with polarity correction
// ---------------------------------------------------------------------------

/**
 * Scale factor converting OKLab ΔL to the contrast score range used by
 * CONTRAST_THRESHOLDS (content=75, control=60, display=60, informational=60, decorative=15).
 *
 * Calibrated against the Brio dark token set. The anchor pair fg-default/bg-app
 * has OKLab ΔL≈0.727 (fgL≈0.935, bgL≈0.208), yielding a score of ≈−92.7 with
 * POLARITY_FACTOR=0.85 — comfortably above the content threshold of 75.
 *
 * Reference: Ottosson 2020 OKLab perceptual lightness model.
 */
export const CONTRAST_SCALE = 150;

/**
 * Polarity correction factor applied to negative-polarity contrast (light
 * element on dark surface).
 *
 * Vision science literature (Piepenbrock 2013, Whittle 1986) documents that
 * light-on-dark text requires ~15% more physical contrast to reach the same
 * perceived readability as dark-on-light text. This factor applies a
 * corresponding reduction: negative-polarity scores are multiplied by 0.85.
 *
 * Starting value: 0.85 (matching the published ~15% disadvantage figure).
 * Calibrated against Brio dark token set to preserve pass/fail boundaries.
 *
 * References:
 *   Piepenbrock et al. (2013) — "Positive Display Polarity Is Particularly
 *     Advantageous for Small Character Sizes"
 *   Whittle (1986) — "Increments and decrements: luminance discrimination"
 */
export const POLARITY_FACTOR = 0.85;

/**
 * Minimum OKLab ΔL below which contrast is reported as zero.
 *
 * Pairs whose surface and element L values differ by less than this amount
 * are perceptually indistinguishable in lightness and produce a score of 0.
 * This is the OKLab-equivalent of the soft-clip behaviour in the previous
 * algorithm.
 */
export const CONTRAST_MIN_DELTA = 0.03;

/**
 * Compute the perceptual contrast for an element/surface pair.
 *
 * Implements the OKLab L-based metric (Spec S01):
 *   1. Convert each hex color to OKLab L via hexToOkLabL (Spec S02).
 *   2. Compute deltaL = surfaceL - elementL.
 *   3. If |deltaL| < CONTRAST_MIN_DELTA, return 0.
 *   4. Positive polarity (surface is lighter, dark element on light surface):
 *        return deltaL * CONTRAST_SCALE
 *   5. Negative polarity (surface is darker, light element on dark surface):
 *        return deltaL * CONTRAST_SCALE * POLARITY_FACTOR
 *
 * Returns the signed contrast score:
 *   - Positive: dark element on light surface (positive polarity)
 *   - Negative: light element on dark surface (negative polarity, after correction)
 *   - 0: insufficient lightness delta (perceptually indistinguishable)
 *
 * Magnitude is the normative contrast gate per CONTRAST_THRESHOLDS:
 *   >= 75 → content (primary prose text)
 *   >= 60 → control / display / informational (interactive labels, titles, metadata)
 *   >= 15 → decorative (non-text ornamental marks)
 *
 * @param elementHex - Element (foreground) color as #rrggbb
 * @param surfaceHex - Surface (background) color as #rrggbb
 * @returns Signed perceptual contrast score
 */
export function computePerceptualContrast(elementHex: string, surfaceHex: string): number {
  const elementL = hexToOkLabL(elementHex);
  const surfaceL = hexToOkLabL(surfaceHex);

  const deltaL = surfaceL - elementL;

  if (Math.abs(deltaL) < CONTRAST_MIN_DELTA) return 0;

  if (deltaL > 0) {
    // Positive polarity: dark element on light surface
    return deltaL * CONTRAST_SCALE;
  } else {
    // Negative polarity: light element on dark surface
    // Apply polarity correction — light-on-dark requires more contrast for same readability
    return deltaL * CONTRAST_SCALE * POLARITY_FACTOR;
  }
}

// ---------------------------------------------------------------------------
// Contrast thresholds per Table T01
// ---------------------------------------------------------------------------

/**
 * Minimum WCAG 2.x contrast ratio per contrast role (Table T02).
 *
 *   content       → 4.5:1 (WCAG AA for 14px/400wt body text)
 *   control       → 3.0:1 (WCAG AA for 18px+ / 700wt interactive element labels)
 *   display       → 3.0:1 (WCAG AA for titles, headers, emphasis)
 *   informational → 3.0:1 (WCAG AA for muted/metadata text and informational elements)
 *   decorative    → 1.0   (no minimum — non-text ornamental marks)
 */
export const WCAG_CONTRAST_THRESHOLDS: Record<string, number> = {
  content: 4.5,
  control: 3.0,
  display: 3.0,
  informational: 3.0,
  decorative: 1.0,
};

// ---------------------------------------------------------------------------
// validateThemeContrast
// ---------------------------------------------------------------------------

/**
 * Validate all element/surface pairings for a derived theme.
 *
 * Converts each resolved OKLCH color to hex via `oklchToHex()`, then checks
 * WCAG 2.x contrast ratio (informational) and perceptual contrast
 * (normative) for each entry in the pairing map.
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

    let fgHex: string;
    let bgHex: string;

    if (pairing.parentSurface) {
      // Alpha-composite resolution (Spec S02): when parentSurface is specified,
      // composite any semi-transparent side over the parent before measuring contrast.
      const parentColor = resolved[pairing.parentSurface];
      if (!parentColor) {
        // parentSurface not in resolved map — skip (same policy as missing element/surface)
        continue;
      }

      fgHex =
        (fgColor.alpha ?? 1.0) < 1.0
          ? compositeOverSurface(fgColor, parentColor)
          : oklchToHex(fgColor.L, fgColor.C, fgColor.h);

      bgHex =
        (bgColor.alpha ?? 1.0) < 1.0
          ? compositeOverSurface(bgColor, parentColor)
          : oklchToHex(bgColor.L, bgColor.C, bgColor.h);
    } else {
      fgHex = oklchToHex(fgColor.L, fgColor.C, fgColor.h);
      bgHex = oklchToHex(bgColor.L, bgColor.C, bgColor.h);
    }

    const wcagRatio = computeWcagContrast(fgHex, bgHex);
    const contrast = computePerceptualContrast(fgHex, bgHex);

    const contrastThreshold = CONTRAST_THRESHOLDS[pairing.role] ?? 15;
    const contrastPass = Math.abs(contrast) >= contrastThreshold;

    results.push({
      fg: pairing.element,
      bg: pairing.surface,
      wcagRatio,
      contrast,
      contrastPass,
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
 *
 * Used by enforceContrastFloor in theme-engine.ts for the binary
 * search in tone space — avoids a hex round-trip when both element and surface L
 * values are already known.
 *
 * @param tone - Tone value in [0, 100]
 * @param hueName - Hue name for canonical L lookup (e.g. "cobalt", "violet")
 * @returns OKLCH lightness value in [L_DARK, L_LIGHT]
 */
export function toneToL(tone: number, hueName: string): number {
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
 * Preset parameter values for the five named presets.
 * Must match TUG_COLOR_PRESETS in palette-engine.ts.
 */
const PRESET_PARAMS: Record<string, { intensity: number; tone: number }> = {
  light: { intensity: 20, tone: 85 },
  dark: { intensity: 50, tone: 20 },
  intense: { intensity: 90, tone: 50 },
  muted: { intensity: 50, tone: 42 },
  canonical: { intensity: 50, tone: 50 },
};

/**
 * Parse a --tug-color() token string into its hue reference, intensity, and tone.
 *
 * Handles all compact forms produced by the derivation engine:
 *   --tug-color(violet)                  → hueRef=violet, i=50, t=50
 *   --tug-color(violet-light)            → hueRef=violet, i=20, t=85
 *   --tug-color(cobalt-indigo)           → hueRef=cobalt-indigo, i=50, t=50
 *   --tug-color(cobalt-indigo-light)     → hueRef=cobalt-indigo, i=20, t=85
 *   --tug-color(violet, i: 10, t: 60)   → hueRef=violet, i=10, t=60
 *   --tug-color(cobalt-indigo, t: 80)   → hueRef=cobalt-indigo, i=50, t=80
 *
 * Uses last-segment-wins strategy: split hueStr on hyphens, check if the last
 * segment is a known preset name. If so, join remaining segments as hueRef.
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

  // Last-segment-wins: check if the last hyphen-delimited segment is a known preset name.
  // This correctly handles both:
  //   "violet-light"       → hueRef="violet", preset="light"
  //   "cobalt-indigo-light" → hueRef="cobalt-indigo", preset="light"
  //   "cobalt-indigo"      → no preset (last segment "indigo" not a preset)
  if (commaIdx === -1) {
    const lastHyphen = hueStr.lastIndexOf("-");
    if (lastHyphen > 0) {
      const lastSeg = hueStr.slice(lastHyphen + 1);
      if (lastSeg in PRESET_PARAMS) {
        const stem = hueStr.slice(0, lastHyphen);
        const { intensity, tone } = PRESET_PARAMS[lastSeg];
        return { hueRef: stem, intensity, tone };
      }
    }
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
 * Preserves the hue reference exactly as-is (base name or hyphenated adjacency),
 * only changing the i/t parameters. Uses compact form rules:
 *   - Canonical (i=50, t=50): --tug-color(hue)
 *   - Preset match: --tug-color(hue-preset) (applies to any hue ref including hyphenated)
 *   - Full form: --tug-color(hue, i: N, t: N)
 *
 * Preset values match TUG_COLOR_PRESETS in palette-engine.ts:
 *   light: i=20, t=85  |  dark: i=50, t=20  |  intense: i=90, t=50
 *   muted: i=50, t=42  |  canonical: i=50, t=50
 */
function rebuildTugColorToken(hueRef: string, intensity: number, tone: number): string {
  const ri = Math.round(intensity);
  const rt = Math.round(tone);

  if (ri === 50 && rt === 50) return `--tug-color(${hueRef})`;

  // Preset shortcuts apply to any hue ref (base name or hyphenated adjacency).
  // After migration, hueRefs never contain numeric offsets.
  if (ri === 20 && rt === 85) return `--tug-color(${hueRef}-light)`;
  if (ri === 50 && rt === 20) return `--tug-color(${hueRef}-dark)`;
  if (ri === 90 && rt === 50) return `--tug-color(${hueRef}-intense)`;
  // muted preset: palette-engine defines muted as { intensity: 50, tone: 42 }
  if (ri === 50 && rt === 42) return `--tug-color(${hueRef}-muted)`;

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
 * For hyphenated adjacency forms like "cobalt-indigo" returns "cobalt" (dominant/primary).
 * Falls back to "violet" if no match found.
 */
function baseHueName(hueRef: string): string {
  // The primary (dominant) color is the first hyphen-delimited segment.
  // For bare names, the first segment is the whole name.
  const firstSeg = hueRef.split("-")[0];
  return (firstSeg in DEFAULT_CANONICAL_L) ? firstSeg : "violet";
}

/**
 * Automatically adjust element token tones to satisfy perceptual contrast thresholds.
 *
 * @deprecated Contrast floor enforcement is now performed by `enforceContrastFloor`
 * inside the derivation engine's `evaluateRules` pass, producing compliant tokens by
 * construction. Structured diagnostics are available as `ThemeOutput.diagnostics`
 * (populated with `ContrastDiagnostic` entries). This function is retained for
 * backward compatibility and unit-test coverage only; it is no longer called by
 * the derivation pipeline or the gallery UI.
 *
 * Strategy per plan spec (cascade-aware, convergence-based):
 *   1. Group all failing pairs by element token.
 *   2. For each element token, find the most restrictive surface (the surface
 *      producing the lowest perceptual contrast), using contrast sign to determine bump direction:
 *      positive contrast (dark-on-light) → bump darker; negative contrast (light-on-dark) → bump lighter.
 *   3. Bump the element tone by TONE_STEP in the computed direction.
 *   4. After each full pass, re-validate ALL pairs via validateThemeContrast so
 *      cascade effects (adjusting token A may break token B) are caught immediately.
 *   5. Convergence: stop if no pairs improved during a pass (contrastPass count did not
 *      increase and no adjustments were applied).
 *   6. Oscillation detection per Spec S03: track per-token direction history.
 *      If a token's last three adjustments strictly alternate directions
 *      (+1,-1,+1 or -1,+1,-1), freeze it and add to unfixable.
 *   7. Safety cap at SAFETY_CAP = 20 iterations to prevent infinite loops.
 *
 * [D02] Cascade-aware auto-adjust
 * [D03] Any-token-type bumping (element token regardless of fg/bg/border role)
 * [D06] Perceptual contrast as normative threshold gate
 * Spec S03: Oscillation detection
 *
 * @param tokens - Token string map from deriveTheme() (--tug-color() strings)
 * @param resolved - Resolved OKLCH map from deriveTheme() [D09]
 * @param failures - ContrastResult entries where contrastPass is false (initial failures)
 * @param pairingMap - Full pairing map for cascade-aware re-validation after each pass
 * @returns Updated tokens and resolved maps, plus list of unfixable element token names
 */
export function autoAdjustContrast(
  tokens: Record<string, string>,
  resolved: Record<string, ResolvedColor>,
  failures: ContrastResult[],
  pairingMap: ElementSurfacePairing[],
): {
  tokens: Record<string, string>;
  resolved: Record<string, ResolvedColor>;
  unfixable: string[];
} {
  // Work on mutable copies
  const updatedTokens: Record<string, string> = { ...tokens };
  const updatedResolved: Record<string, ResolvedColor> = { ...resolved };

  // Safety cap — prevents infinite loops under pathological inputs
  const SAFETY_CAP = 20;
  // Tone step per bump — 5 tone units, re-evaluated each iteration
  const TONE_STEP = 5;

  // Per-token direction history for oscillation detection (Spec S03).
  // Tracks the sequence of +1 / -1 bump directions applied to each element token.
  const directionHistory = new Map<string, number[]>();

  // Tokens frozen due to oscillation — excluded from further bumps
  const frozenTokens = new Set<string>();

  let remainingFailures = failures.filter((f) => !f.contrastPass);
  const unfixable: string[] = [];

  // Track the passing count from the previous iteration for convergence detection
  let prevPassCount = pairingMap.length - remainingFailures.length;

  for (let iter = 0; iter < SAFETY_CAP; iter++) {
    if (remainingFailures.length === 0) break;

    // Group remaining failures by element token
    const byElement = new Map<string, ContrastResult[]>();
    for (const failure of remainingFailures) {
      const list = byElement.get(failure.fg) ?? [];
      list.push(failure);
      byElement.set(failure.fg, list);
    }

    let anyAdjustmentApplied = false;

    // For each element token, find the most restrictive surface and bump element tone
    for (const [elementToken, elementFailures] of byElement) {
      // Skip tokens frozen by oscillation detection
      if (frozenTokens.has(elementToken)) continue;

      const elementColor = updatedResolved[elementToken];
      if (!elementColor) continue;

      // Find the most restrictive surface (the one producing the lowest perceptual contrast).
      // "Most restrictive" = worst contrast, i.e. smallest magnitude among all failing surfaces.
      let worstSurfaceColor: ResolvedColor | null = null;
      let worstContrast = Infinity;
      let worstContrastSigned = 0;
      for (const failure of elementFailures) {
        const surfaceColor = updatedResolved[failure.bg];
        if (!surfaceColor) continue;
        const elementHex = oklchToHex(elementColor.L, elementColor.C, elementColor.h);
        const surfaceHex = oklchToHex(surfaceColor.L, surfaceColor.C, surfaceColor.h);
        const contrast = computePerceptualContrast(elementHex, surfaceHex);
        if (Math.abs(contrast) < worstContrast) {
          worstContrast = Math.abs(contrast);
          worstContrastSigned = contrast;
          worstSurfaceColor = surfaceColor;
        }
      }

      if (!worstSurfaceColor) continue;

      // Determine bump direction using contrast sign (polarity semantics) [D02]:
      //   positive contrast = dark element on light surface → bump element darker (tone -1)
      //   negative contrast = light element on dark surface → bump element lighter (tone +1)
      //
      // Special case: when contrast = 0 (soft-clipped because both colors are very dark
      // or very light), the sign is uninformative. Fall back to comparing OKLCH
      // lightness values directly to determine polarity and bump direction.
      //   elementL > surfaceL → element is lighter → light-on-dark polarity → bump lighter (+1)
      //   elementL <= surfaceL → element is darker → dark-on-light polarity → bump darker (-1)
      let bumpDirection: number;
      if (worstContrastSigned === 0) {
        bumpDirection = elementColor.L > worstSurfaceColor.L ? 1 : -1;
      } else {
        bumpDirection = worstContrastSigned >= 0 ? -1 : 1;
      }

      // Oscillation detection (Spec S03): record this direction and check for alternation.
      const history = directionHistory.get(elementToken) ?? [];
      history.push(bumpDirection);
      directionHistory.set(elementToken, history);

      // Freeze if the last 3 directions strictly alternate: [+1,-1,+1] or [-1,+1,-1]
      if (history.length >= 3) {
        const last3 = history.slice(-3);
        const oscillating =
          last3[0] !== last3[1] && last3[1] !== last3[2] && last3[0] === last3[2];
        if (oscillating) {
          frozenTokens.add(elementToken);
          continue;
        }
      }

      // Parse the original --tug-color() string to extract hue reference and intensity.
      // This preserves hue+offset forms (e.g. "cobalt+6") exactly, avoiding the
      // oklchToTugColor() hue-recovery path which loses offsets >5° from named hues.
      const originalTokenStr = updatedTokens[elementToken];
      const parsed = parseTugColorToken(originalTokenStr);
      if (!parsed) continue;

      const { hueRef, intensity } = parsed;
      const hueName = baseHueName(hueRef);
      const elementL = elementColor.L;
      const currentTone = lToTone(elementL, hueName);
      const newTone = Math.max(0, Math.min(100, currentTone + bumpDirection * TONE_STEP));

      // Only apply bump if tone actually changed (avoids no-op at ceiling/floor)
      if (newTone === currentTone) continue;

      const newL = toneToL(newTone, hueName);
      const newResolved: ResolvedColor = { ...elementColor, L: newL };
      const newTokenStr = rebuildTugColorToken(hueRef, intensity, newTone);

      updatedResolved[elementToken] = newResolved;
      updatedTokens[elementToken] = newTokenStr;
      anyAdjustmentApplied = true;
    }

    // Re-validate ALL pairs via validateThemeContrast to catch cascade effects [D02].
    // This ensures that adjusting one token doesn't silently break another pair.
    const allResults = validateThemeContrast(updatedResolved, pairingMap);
    remainingFailures = allResults.filter((r) => !r.contrastPass);

    // Convergence detection: stop if no pairs improved and no adjustments were applied.
    const newPassCount = allResults.filter((r) => r.contrastPass).length;
    if (!anyAdjustmentApplied && newPassCount <= prevPassCount) break;
    prevPassCount = newPassCount;
  }

  // Collect unfixable element tokens: any token still failing AND either frozen
  // (oscillation) or still present in remaining failures after the loop ends.
  const unfixableElementTokens = new Set<string>([...frozenTokens]);
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

// ---------------------------------------------------------------------------
// Alpha compositing — Spec S02
// ---------------------------------------------------------------------------

/**
 * Alpha-composite a semi-transparent token over a fully-opaque parent surface.
 *
 * Both inputs are ResolvedColor values (OKLCH). The function converts each to
 * linear sRGB via `oklchToLinearSRGB`, applies the standard alpha-over formula
 * in linear sRGB, gamma-encodes the result, and returns a #rrggbb hex string.
 *
 * The parent surface MUST be fully opaque (alpha === 1.0 or undefined). Nested
 * compositing (semi-transparent parent) is not supported and throws.
 *
 * Formula (per channel, linear sRGB):
 *   C_out = token.C * alpha + parent.C * (1 - alpha)
 *
 * @param token  - Semi-transparent token to composite
 * @param parent - Opaque parent surface to composite over
 * @returns Composited color as #rrggbb hex string
 * @throws If parent.alpha is defined and < 1.0 (nested compositing not supported)
 */
export function compositeOverSurface(token: ResolvedColor, parent: ResolvedColor): string {
  const parentAlpha = parent.alpha ?? 1.0;
  if (parentAlpha < 1.0) {
    throw new Error(
      `compositeOverSurface: parentSurface must be fully opaque (alpha=1.0), ` +
      `got alpha=${parentAlpha}. Nested compositing is not supported.`,
    );
  }

  const tokenLinear = oklchToLinearSRGB(token.L, token.C, token.h);
  const parentLinear = oklchToLinearSRGB(parent.L, parent.C, parent.h);
  const alpha = token.alpha ?? 1.0;

  const r = tokenLinear.r * alpha + parentLinear.r * (1 - alpha);
  const g = tokenLinear.g * alpha + parentLinear.g * (1 - alpha);
  const b = tokenLinear.b * alpha + parentLinear.b * (1 - alpha);

  const rOut = Math.round(Math.max(0, Math.min(1, linearToSrgbGamma(r))) * 255);
  const gOut = Math.round(Math.max(0, Math.min(1, linearToSrgbGamma(g))) * 255);
  const bOut = Math.round(Math.max(0, Math.min(1, linearToSrgbGamma(b))) * 255);

  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(rOut)}${toHex(gOut)}${toHex(bOut)}`;
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
  ["--tug-base-element-tone-fill-normal-success-rest", "--tug-base-element-tone-fill-normal-caution-rest"],
  // Status signals: success (green) vs danger/destructive (red-family)
  ["--tug-base-element-tone-fill-normal-success-rest", "--tug-base-element-tone-fill-normal-danger-rest"],
  // Primary action vs destructive action (button colours)
  ["--tug-base-element-global-fill-normal-accent-rest", "--tug-base-element-tone-fill-normal-danger-rest"],
  // Accent vs atmosphere (theme identity colours)
  ["--tug-base-element-global-fill-normal-accent-rest", "--tug-base-surface-global-primary-normal-app-rest"],
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
export type { ResolvedColor, ContrastResult, CVDWarning } from "./theme-engine";

// ---------------------------------------------------------------------------
// Perceptual contrast thresholds (normative) and WCAG ratio thresholds (informational)
// ---------------------------------------------------------------------------

/**
 * Minimum perceptual contrast magnitude per role — normative gate [D06].
 *
 * Semantic text type thresholds (Table T02):
 *   content       → 75  (primary prose text — body, descriptions, paragraphs)
 *   control       → 60  (interactive element labels, icons, borders, focus indicators)
 *   display       → 60  (titles, headers, card titles, emphasis text)
 *   informational → 60  (muted/metadata/secondary text and informational elements)
 *   decorative    → 15  (non-text ornamental marks, structural dividers)
 */
export const CONTRAST_THRESHOLDS: Record<string, number> = {
  content: 75,
  control: 60,
  display: 60,
  informational: 60,
  decorative: 15,
};

/**
 * Near-pass band for marginal badge classification (fixed 5 units, per Spec S04).
 * A result with magnitude >= (CONTRAST_THRESHOLDS[role] - CONTRAST_MARGINAL_DELTA) is classified as
 * "marginal" rather than "fail".
 */
export const CONTRAST_MARGINAL_DELTA = 5;
