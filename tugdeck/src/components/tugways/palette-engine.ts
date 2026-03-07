/**
 * Palette Engine — Tugways HVV Runtime
 *
 * Computes a continuous OKLCH color palette from 24 named hue families using
 * the HueVibVal (HVV) system. Each color is defined by three axes:
 *   - Hue: one of 24 named color families mapped to OKLCH hue angles
 *   - Vibrancy (0-100): chroma axis; at vib=50, C equals the sRGB-safe max
 *   - Value (0-100): lightness axis; val=50 gives the per-hue canonical L
 *
 * The CSS injection function `injectHvvCSS` emits three layers:
 *   - Layer 1: 168 semantic preset variables (7 presets × 24 hues)
 *   - Layer 2: 74 per-hue constant variables (3 per hue + 2 global)
 *   - Layer 3: @media (color-gamut: p3) block with wider-gamut overrides
 *
 * Legacy functions (injectPaletteCSS, tugPaletteColor, tugAnchoredColor, etc.)
 * are still present in this step and will be removed in Step 5.
 *
 * @module components/tugways/palette-engine
 */

// ---------------------------------------------------------------------------
// HUE_FAMILIES — 24 named hue families mapped to OKLCH hue angles
// ---------------------------------------------------------------------------

/**
 * 24 hue family names mapped to OKLCH hue angles (degrees).
 * Angle values derived from the Tugways Phase 5d5a theme overhaul proposal.
 * cherry=10 through crimson=355.
 */
export const HUE_FAMILIES: Record<string, number> = {
  cherry:  10,
  red:     25,
  tomato:  35,
  flame:   45,
  orange:  55,
  amber:   65,
  gold:    75,
  yellow:  90,
  lime:   115,
  green:  140,
  mint:   155,
  teal:   175,
  cyan:   200,
  sky:    215,
  blue:   230,
  indigo: 250,
  violet: 270,
  purple: 285,
  plum:   300,
  pink:   320,
  rose:   335,
  magenta:345,
  crimson:355,
  coral:   20,
};

// ---------------------------------------------------------------------------
// LCParams — Transfer function anchor parameters (legacy, kept for Step 5)
// ---------------------------------------------------------------------------

/**
 * Transfer function anchor parameters.
 * Defines the L (lightness) and C (chroma) range for the palette.
 */
export interface LCParams {
  /** L value at intensity 0 (near-white) */
  lMax: number;
  /** L value at intensity 100 (deep/saturated) */
  lMin: number;
  /** C value at intensity 0 (near-neutral) */
  cMin: number;
  /** C value at intensity 100 (most saturated) */
  cMax: number;
}

/**
 * Default LC anchor parameters.
 * Starting values per D01: L_MAX=0.96, L_MIN=0.42, C_MIN=0.01, C_MAX=0.22
 */
export const DEFAULT_LC_PARAMS: LCParams = {
  lMax: 0.96,
  lMin: 0.42,
  cMin: 0.01,
  cMax: 0.22,
};

// ---------------------------------------------------------------------------
// TONE_ALIASES — Named tone alias mappings (legacy, kept for Step 5)
// ---------------------------------------------------------------------------

/**
 * Named tone aliases mapping semantic names to intensity values.
 * soft=15, default=50, strong=75, intense=100
 */
export const TONE_ALIASES: Record<string, number> = {
  soft:    15,
  default: 50,
  strong:  75,
  intense: 100,
};

// ---------------------------------------------------------------------------
// Standard stops (legacy, kept for Step 5)
// ---------------------------------------------------------------------------

/** The 11 standard intensity stops (Spec S03). */
const STANDARD_STOPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

// ---------------------------------------------------------------------------
// Transfer function — smoothstep (legacy, kept for Step 5)
// ---------------------------------------------------------------------------

/**
 * Smoothstep easing: compresses extremes, expands midrange.
 * Input t must be in [0, 1].
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Map intensity [0, 100] to OKLCH L and C values using the smoothstep curve.
 * At intensity 0: high L (near-white), low C (near-neutral).
 * At intensity 100: low L (deep), high C (saturated).
 */
function intensityToLC(intensity: number, params: LCParams = DEFAULT_LC_PARAMS): { L: number; C: number } {
  const t = Math.max(0, Math.min(100, intensity)) / 100;
  const s = smoothstep(t);
  const L = params.lMax + s * (params.lMin - params.lMax);
  const C = params.cMin + s * (params.cMax - params.cMin);
  return { L, C };
}

// ---------------------------------------------------------------------------
// OKLCH → sRGB conversion
// ---------------------------------------------------------------------------

/**
 * Convert OKLCH polar coordinates to linear sRGB channels.
 * Returns { r, g, b } where each channel is in [0, 1] for in-gamut colors.
 *
 * Pipeline (per Bjorn Ottosson's canonical OKLab specification):
 *   1. OKLCH → OKLab (polar to Cartesian)
 *   2. OKLab → LMS (inverse OKLab matrix)
 *   3. LMS cube (undo cube-root compression)
 *   4. LMS → linear sRGB (second matrix)
 *
 * Matrices from: https://bottosson.github.io/posts/oklab/
 *
 * Exported for use in gamut-safety tests and _deriveChromaCaps.
 */
export function oklchToLinearSRGB(L: number, C: number, h: number): { r: number; g: number; b: number } {
  // Step 1: OKLCH polar → OKLab Cartesian
  const hRad = (h * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // Step 2: OKLab → LMS^ (via inverse OKLab M1 matrix)
  const lHat = L + 0.3963377774 * a + 0.2158037573 * b;
  const mHat = L - 0.1055613458 * a - 0.0638541728 * b;
  const sHat = L - 0.0894841775 * a - 1.2914855480 * b;

  // Step 3: Undo cube-root compression (LMS^ → LMS)
  const lLMS = lHat * lHat * lHat;
  const mLMS = mHat * mHat * mHat;
  const sLMS = sHat * sHat * sHat;

  // Step 4: LMS → linear sRGB (M2 matrix)
  const r =  4.0767416621 * lLMS - 3.3077115913 * mLMS + 0.2309699292 * sLMS;
  const g = -1.2684380046 * lLMS + 2.6097574011 * mLMS - 0.3413193965 * sLMS;
  const bVal = -0.0041960863 * lLMS - 0.7034186147 * mLMS + 1.7076147010 * sLMS;

  return { r, g, b: bVal };
}

/**
 * Check if an OKLCH color is within the sRGB gamut (all channels in [0, 1]).
 * Allows a small epsilon for floating point rounding.
 *
 * Exported for use in gamut-safety tests and _deriveChromaCaps.
 */
export function isInSRGBGamut(L: number, C: number, h: number, epsilon = 0.001): boolean {
  const { r, g, b } = oklchToLinearSRGB(L, C, h);
  return (
    r >= -epsilon && r <= 1 + epsilon &&
    g >= -epsilon && g <= 1 + epsilon &&
    b >= -epsilon && b <= 1 + epsilon
  );
}

/**
 * Find the maximum chroma at a given L and hue angle that stays within the
 * specified gamut (defaults to sRGB). Binary search in [0, maxSearch].
 *
 * @param L - OKLCH lightness
 * @param h - OKLCH hue angle (degrees)
 * @param maxSearch - upper bound for binary search (default 0.4)
 * @param steps - number of binary search iterations (default 32)
 * @param gamutCheck - gamut boundary function (defaults to isInSRGBGamut)
 */
export function findMaxChroma(
  L: number,
  h: number,
  maxSearch = 0.4,
  steps = 32,
  gamutCheck: (L: number, C: number, h: number, epsilon?: number) => boolean = isInSRGBGamut,
): number {
  let lo = 0;
  let hi = maxSearch;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (gamutCheck(L, mid, h)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // Apply a small safety margin
  return lo * 0.98;
}

// ---------------------------------------------------------------------------
// _deriveChromaCaps — parameterized chroma cap derivation helper
// ---------------------------------------------------------------------------

/**
 * Derive per-hue chroma caps using binary search across L sample points.
 *
 * For each hue in HUE_FAMILIES, binary-searches the maximum safe chroma at
 * each L sample point (via findMaxChroma with the provided gamutCheck), takes
 * the minimum across all sample points, applies the 2% safety margin (inside
 * findMaxChroma), and optionally caps at maxCap.
 *
 * Per Spec S06:
 * - sRGB derivation: _deriveChromaCaps(hvvLSamples, isInSRGBGamut, DEFAULT_LC_PARAMS.cMax)
 * - P3 derivation: _deriveChromaCaps(hvvLSamples, isInP3Gamut) — no maxCap
 *
 * Not called at runtime. Run once to regenerate static tables.
 */
export function _deriveChromaCaps(
  lSamples: (hue: string) => number[],
  gamutCheck: (L: number, C: number, h: number, epsilon?: number) => boolean,
  maxCap?: number,
): Record<string, number> {
  const caps: Record<string, number> = {};
  for (const [name, angle] of Object.entries(HUE_FAMILIES)) {
    const samples = lSamples(name);
    const minSafe = Math.min(...samples.map((L) => findMaxChroma(L, angle, 0.4, 32, gamutCheck)));
    const cap = maxCap !== undefined ? Math.min(minSafe, maxCap) : minSafe;
    caps[name] = Math.round(cap * 1000) / 1000;
  }
  return caps;
}

// ---------------------------------------------------------------------------
// HVV Constants — promoted from gallery-palette-content.tsx
// ---------------------------------------------------------------------------

/** Lightness at val=0 (very dark). */
export const L_DARK = 0.15;

/** Lightness at val=100 (very light). */
export const L_LIGHT = 0.96;

/**
 * Peak chroma scale factor. Peak chroma = MAX_CHROMA_FOR_HUE * PEAK_C_SCALE.
 * At vib=50, C equals the sRGB-safe max; above 50 pushes into P3.
 */
export const PEAK_C_SCALE = 2;

/**
 * Default canonical L values for all 24 hue families (Table T02).
 * These are the reference lightness values at vib=50, val=50.
 * Must remain above 0.555 (piecewise min() constraint, D04).
 */
export const DEFAULT_CANONICAL_L: Record<string, number> = {
  cherry: 0.619,
  red:    0.659,
  tomato: 0.704,
  flame:  0.740,
  orange: 0.780,
  amber:  0.821,
  gold:   0.852,
  yellow: 0.901,
  lime:   0.861,
  green:  0.821,
  mint:   0.807,
  teal:   0.803,
  cyan:   0.803,
  sky:    0.807,
  blue:   0.771,
  indigo: 0.744,
  violet: 0.708,
  purple: 0.686,
  plum:   0.731,
  pink:   0.794,
  rose:   0.758,
  magenta:0.726,
  crimson:0.668,
  coral:  0.632,
};

/**
 * Seven semantic presets per hue. Each preset maps a name to {vib, val}.
 * Per List L04 in the plan specification.
 */
export const HVV_PRESETS: Record<string, { vib: number; val: number }> = {
  canonical: { vib: 50, val: 50 },
  accent:    { vib: 80, val: 50 },
  muted:     { vib: 25, val: 55 },
  light:     { vib: 30, val: 82 },
  subtle:    { vib: 15, val: 92 },
  dark:      { vib: 50, val: 25 },
  deep:      { vib: 70, val: 15 },
};

// ---------------------------------------------------------------------------
// MAX_CHROMA_FOR_HUE — Per-hue chroma caps re-derived for HVV L range
// ---------------------------------------------------------------------------

/**
 * Per-hue maximum chroma for sRGB gamut safety.
 *
 * Hardcoded static table per decision [D02] — not computed at runtime.
 * Re-derived using HVV L sample points per [D08]:
 *   lSamples(hue) = [L_DARK (0.15), DEFAULT_CANONICAL_L[hue], L_LIGHT (0.96)]
 * Binary-searched max chroma at each sample, minimum taken, 2% safety margin
 * applied, capped at DEFAULT_LC_PARAMS.cMax (0.22).
 *
 * Values are lower than the legacy table because L_DARK=0.15 is much darker
 * than the old lMin=0.42, resulting in tighter gamut constraints at dark tones.
 *
 * To regenerate: call _deriveChromaCaps(hvvLSamples, isInSRGBGamut, DEFAULT_LC_PARAMS.cMax)
 * where hvvLSamples(hue) = [L_DARK, DEFAULT_CANONICAL_L[hue], L_LIGHT].
 */
export const MAX_CHROMA_FOR_HUE: Record<string, number> = {
  cherry:  0.020,
  red:     0.019,
  tomato:  0.020,
  flame:   0.021,
  orange:  0.023,
  amber:   0.026,
  gold:    0.032,
  yellow:  0.045,
  lime:    0.050,
  green:   0.069,
  mint:    0.048,
  teal:    0.037,
  cyan:    0.033,
  sky:     0.031,
  blue:    0.023,
  indigo:  0.019,
  violet:  0.019,
  purple:  0.019,
  plum:    0.022,
  pink:    0.030,
  rose:    0.029,
  magenta: 0.024,
  crimson: 0.022,
  coral:   0.019,
};

// ---------------------------------------------------------------------------
// hvvColor — HVV color computation function
// ---------------------------------------------------------------------------

/**
 * Compute an oklch() CSS string from hue name, vibrancy (0-100), value (0-100),
 * and canonical lightness.
 *
 * val → L: piecewise linear through canonicalL at val=50.
 *   val=0   → L_DARK (0.15)
 *   val=50  → canonicalL
 *   val=100 → L_LIGHT (0.96)
 *
 * vib → C: linear from 0 to peakC.
 *   vib=0   → C=0 (achromatic)
 *   vib=50  → C = MAX_CHROMA_FOR_HUE * PEAK_C_SCALE / 2 = sRGB max
 *   vib=100 → C = peakC = MAX_CHROMA_FOR_HUE * PEAK_C_SCALE
 *
 * @param hueName - One of the 24 hue family names in HUE_FAMILIES
 * @param vib - Vibrancy axis, 0-100
 * @param val - Value axis, 0-100
 * @param canonicalL - Canonical lightness for this hue at vib=50, val=50
 * @param peakChroma - Optional peak chroma override. When omitted, defaults to
 *   MAX_CHROMA_FOR_HUE[hueName] * PEAK_C_SCALE (sRGB-derived). When provided,
 *   allows P3-wider chroma (e.g., MAX_P3_CHROMA_FOR_HUE[hueName] * PEAK_C_SCALE).
 * @returns An `oklch(L C h)` CSS string.
 */
export function hvvColor(
  hueName: string,
  vib: number,
  val: number,
  canonicalL: number,
  peakChroma?: number,
): string {
  const h = HUE_FAMILIES[hueName] ?? 0;
  const maxC = MAX_CHROMA_FOR_HUE[hueName] ?? 0.022;
  const peakC = peakChroma !== undefined ? peakChroma : maxC * PEAK_C_SCALE;

  // val → L: piecewise through canonicalL at val=50
  let L: number;
  if (val <= 50) {
    L = L_DARK + (val / 50) * (canonicalL - L_DARK);
  } else {
    L = canonicalL + ((val - 50) / 50) * (L_LIGHT - canonicalL);
  }

  // vib → C: linear 0 → peakC
  const C = (vib / 100) * peakC;

  const fmt = (n: number) => parseFloat(n.toFixed(4)).toString();
  return `oklch(${fmt(L)} ${fmt(C)} ${h})`;
}

// ---------------------------------------------------------------------------
// Core legacy palette functions (kept for Step 5 removal)
// ---------------------------------------------------------------------------

/**
 * Build a clamped oklch() CSS string from raw L, C, and hue name.
 * Clamps C to min(C, MAX_CHROMA_FOR_HUE[hueName]).
 *
 * Legacy function — will be removed in Step 5.
 */
export function clampedOklchString(hueName: string, L: number, C: number): string {
  const maxC = MAX_CHROMA_FOR_HUE[hueName] ?? DEFAULT_LC_PARAMS.cMax;
  const clampedC = Math.min(C, maxC);
  const angle = HUE_FAMILIES[hueName] ?? 0;
  const fmtNum = (n: number) => parseFloat(n.toFixed(4)).toString();
  return `oklch(${fmtNum(L)} ${fmtNum(clampedC)} ${angle})`;
}

/**
 * Compute an oklch() CSS color string for a given hue and intensity.
 * Uses the smoothstep transfer function.
 *
 * Legacy function — will be removed in Step 5.
 */
export function tugPaletteColor(hueName: string, intensity: number, params?: LCParams): string {
  const p = params ?? DEFAULT_LC_PARAMS;
  const { L, C } = intensityToLC(intensity, p);
  return clampedOklchString(hueName, L, C);
}

// ---------------------------------------------------------------------------
// Anchor-based interpolation types (Phase 5d5b — kept for Step 5 removal)
// ---------------------------------------------------------------------------

/**
 * A single hand-tuned anchor point for per-hue palette interpolation.
 * Legacy type — will be removed in Step 5.
 */
export interface AnchorPoint {
  stop: number;
  L: number;
  C: number;
}

/**
 * Complete anchor data for a single hue family.
 * Legacy type — will be removed in Step 5.
 */
export interface HueAnchors {
  anchors: AnchorPoint[];
}

/**
 * Anchor data for all hue families within a single theme.
 * Legacy type — will be removed in Step 5.
 */
export type ThemeHueAnchors = Record<string, HueAnchors>;

/**
 * Anchor data for all themes.
 * Legacy type — will be removed in Step 5.
 */
export type ThemeAnchorData = Record<string, ThemeHueAnchors>;

// ---------------------------------------------------------------------------
// Anchor interpolation (Phase 5d5b — kept for Step 5 removal)
// ---------------------------------------------------------------------------

/**
 * Linearly interpolate L and C between surrounding anchor points.
 * Legacy function — will be removed in Step 5.
 */
function interpolateAnchors(intensity: number, anchors: AnchorPoint[]): { L: number; C: number } {
  const clamped = Math.max(0, Math.min(100, intensity));

  for (const anchor of anchors) {
    if (anchor.stop === clamped) {
      return { L: anchor.L, C: anchor.C };
    }
  }

  let lo = anchors[0];
  let hi = anchors[anchors.length - 1];
  for (let i = 0; i < anchors.length - 1; i++) {
    if (anchors[i].stop <= clamped && anchors[i + 1].stop >= clamped) {
      lo = anchors[i];
      hi = anchors[i + 1];
      break;
    }
  }

  const range = hi.stop - lo.stop;
  if (range === 0) {
    return { L: lo.L, C: lo.C };
  }
  const t = (clamped - lo.stop) / range;
  return {
    L: lo.L + t * (hi.L - lo.L),
    C: lo.C + t * (hi.C - lo.C),
  };
}

/**
 * Compute an oklch() CSS color string using per-hue anchor-based interpolation.
 * Legacy function — will be removed in Step 5.
 */
export function tugAnchoredColor(hueName: string, intensity: number, hueAnchors: HueAnchors): string {
  const { L, C } = interpolateAnchors(intensity, hueAnchors.anchors);
  const angle = HUE_FAMILIES[hueName] ?? 0;
  const fmtNum = (n: number) => parseFloat(n.toFixed(4)).toString();
  return `oklch(${fmtNum(L)} ${fmtNum(C)} ${angle})`;
}

/**
 * Return the CSS custom property name for a palette color.
 * Legacy function — will be removed in Step 5.
 */
export function tugPaletteVarName(hueName: string, intensity: number): string {
  const angle = HUE_FAMILIES[hueName] ?? 0;
  return `--tug-palette-hue-${angle}-${hueName}-tone-${intensity}`;
}

// ---------------------------------------------------------------------------
// CSS injection (legacy — kept for Step 5 removal)
// ---------------------------------------------------------------------------

/** The id of the injected palette style element. */
const PALETTE_STYLE_ID = "tug-palette";

/**
 * Read theme parameter overrides from computed styles on document.body.
 * Legacy function — will be removed in Step 5.
 */
function readThemeParams(): LCParams {
  if (typeof document === "undefined") {
    return { ...DEFAULT_LC_PARAMS };
  }
  const cs = getComputedStyle(document.body);
  const readNum = (prop: string, fallback: number): number => {
    const raw = cs.getPropertyValue(prop).trim();
    if (!raw) return fallback;
    const parsed = parseFloat(raw);
    return isNaN(parsed) ? fallback : parsed;
  };
  return {
    lMax: readNum("--tug-theme-lc-l-max", DEFAULT_LC_PARAMS.lMax),
    lMin: readNum("--tug-theme-lc-l-min", DEFAULT_LC_PARAMS.lMin),
    cMin: readNum("--tug-theme-lc-c-min", DEFAULT_LC_PARAMS.cMin),
    cMax: readNum("--tug-theme-lc-c-max", DEFAULT_LC_PARAMS.cMax),
  };
}

/**
 * Inject all palette CSS variables into a <style id="tug-palette"> element.
 * Legacy function — will be replaced by injectHvvCSS in Step 4, removed in Step 5.
 */
export function injectPaletteCSS(_themeName: string, anchorData?: ThemeHueAnchors): void {
  if (typeof document === "undefined") return;

  const params = anchorData ? DEFAULT_LC_PARAMS : readThemeParams();

  const lines: string[] = [":root {"];

  for (const [name, angle] of Object.entries(HUE_FAMILIES)) {
    const makeOklch = (intensity: number): string => {
      if (anchorData) {
        const hueAnchors = anchorData[name];
        if (hueAnchors) {
          return tugAnchoredColor(name, intensity, hueAnchors);
        }
      }
      return tugPaletteColor(name, intensity, params);
    };

    for (const stop of STANDARD_STOPS) {
      lines.push(`  --tug-palette-hue-${angle}-${name}-tone-${stop}: ${makeOklch(stop)};`);
    }

    for (const [alias, intensity] of Object.entries(TONE_ALIASES)) {
      lines.push(`  --tug-palette-hue-${angle}-${name}-${alias}: ${makeOklch(intensity)};`);
    }
  }

  lines.push("}");
  const css = lines.join("\n");

  let styleEl = document.getElementById(PALETTE_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = PALETTE_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}
