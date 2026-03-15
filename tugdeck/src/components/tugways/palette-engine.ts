/**
 * Palette Engine — Tugways TugColor Runtime
 *
 * Computes a continuous OKLCH color palette from 48 named hue families using
 * the TugColor (Hue · Intensity · Tone · Alpha) system. Each color is defined
 * by four axes:
 *   - Color: one of 48 named color families mapped to OKLCH hue angles
 *   - Intensity (0-100): chroma axis; at intensity=50, C equals the sRGB-safe max
 *   - Tone (0-100): lightness axis; tone=50 gives the per-hue canonical L
 *   - Alpha (0-100): opacity; default 100 (fully opaque)
 *
 * The TugColor palette is expressed as pure CSS in `tug-palette.css`. This module
 * provides `tugColor()` for programmatic JS use and exports the authoritative
 * source tables (HUE_FAMILIES, DEFAULT_CANONICAL_L, MAX_CHROMA_FOR_HUE,
 * MAX_P3_CHROMA_FOR_HUE, PEAK_C_SCALE) that tug-palette.css was derived from.
 *
 * Hyphenated adjacency: any two adjacent colors in ADJACENCY_RING may be combined
 * as `A-B`, resolving to (2/3)*angle(A) + (1/3)*angle(B) — yielding 144 expressible
 * hue points at approximately 2.5-degree average spacing.
 *
 * Five convenience presets per hue (TUG_COLOR_PRESETS):
 *   canonical  intensity=50, tone=50   The crayon color — reference point
 *   light      intensity=20, tone=85   Background-safe, airy
 *   dark       intensity=50, tone=20   Contrast text, dark surfaces
 *   intense    intensity=90, tone=50   Pops, draws attention
 *   muted      intensity=50, tone=42   Subdued, secondary
 *
 * @module components/tugways/palette-engine
 */

// Single source of truth for canonical L values and global lightness anchors.
import tugColorCanonical from "../../../../roadmap/tug-color-canonical.json";

// ---------------------------------------------------------------------------
// HUE_FAMILIES — 48 named hue families mapped to OKLCH hue angles
// ---------------------------------------------------------------------------

/**
 * 48 hue family names mapped to OKLCH hue angles (degrees).
 * Angles from the 48-Color Hyphenated Palette proposal (Table T01).
 * garnet=2.5 through berry=355; all original 24 hues unchanged.
 */
export const HUE_FAMILIES: Record<string, number> = {
  // --- original 24 ---
  cherry:     10,
  coral:      20,
  red:        25,
  tomato:     35,
  flame:      45,
  orange:     55,
  amber:      65,
  gold:       75,
  yellow:     90,
  lime:      115,
  green:     140,
  mint:      155,
  teal:      175,
  cyan:      200,
  sky:       215,
  blue:      230,
  cobalt:    250,
  violet:    270,
  purple:    285,
  plum:      300,
  pink:      320,
  rose:      335,
  magenta:   345,
  berry:     355,
  // --- new 24 ---
  garnet:      2.5,
  scarlet:    15,
  crimson:    22.5,
  vermilion:  30,
  ember:      40,
  tangerine:  50,
  apricot:    60,
  honey:      70,
  saffron:    82.5,
  chartreuse: 102.5,
  grass:     127.5,
  jade:      147.5,
  seafoam:   165,
  aqua:      187.5,
  azure:     207.5,
  cerulean:  222.5,
  sapphire:  240,
  indigo:    260,
  iris:      277.5,
  grape:     292.5,
  orchid:    310,
  peony:     327.5,
  cerise:    340,
  fuchsia:   350,
};

// ---------------------------------------------------------------------------
// LCParams — Chroma derivation parameters
// ---------------------------------------------------------------------------

/**
 * Parameters that bound the chroma derivation search space.
 * `cMax` is the sRGB ceiling used by `_deriveChromaCaps` for the sRGB table.
 * `lMin` / `lMax` are retained for reference but not used by the TugColor runtime.
 */
export interface LCParams {
  /** L value at intensity 0 (near-white) — legacy, kept for reference */
  lMax: number;
  /** L value at intensity 100 (deep) — legacy, kept for reference */
  lMin: number;
  /** C value at intensity 0 (near-neutral) — legacy, kept for reference */
  cMin: number;
  /** Maximum chroma cap for sRGB derivation */
  cMax: number;
}

/**
 * Default LC parameters.
 * cMax=0.22 is the sRGB chroma ceiling used when re-deriving MAX_CHROMA_FOR_HUE.
 */
export const DEFAULT_LC_PARAMS: LCParams = {
  lMax: 0.96,
  lMin: 0.42,
  cMin: 0.01,
  cMax: 0.22,
};

// ---------------------------------------------------------------------------
// OKLCH → linear sRGB conversion
// ---------------------------------------------------------------------------

/**
 * Convert OKLCH polar coordinates to linear sRGB channels.
 * Returns { r, g, b } where each channel is in [0, 1] for in-gamut colors.
 *
 * Pipeline (per Bjorn Ottosson's canonical OKLab specification):
 *   1. OKLCH → OKLab (polar to Cartesian)
 *   2. OKLab → LMS^ (inverse OKLab M1 matrix)
 *   3. LMS^ cube (undo cube-root compression)
 *   4. LMS → linear sRGB (M2 matrix)
 *
 * Matrices from: https://bottosson.github.io/posts/oklab/
 *
 * Exported for use in gamut-safety tests and _deriveChromaCaps.
 */
export function oklchToLinearSRGB(L: number, C: number, h: number): { r: number; g: number; b: number } {
  const hRad = (h * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const lHat = L + 0.3963377774 * a + 0.2158037573 * b;
  const mHat = L - 0.1055613458 * a - 0.0638541728 * b;
  const sHat = L - 0.0894841775 * a - 1.2914855480 * b;

  const lLMS = lHat * lHat * lHat;
  const mLMS = mHat * mHat * mHat;
  const sLMS = sHat * sHat * sHat;

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
 * specified gamut. Binary search in [0, maxSearch].
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
  return lo * 0.98;
}

// ---------------------------------------------------------------------------
// OKLCH → linear Display P3 conversion
// ---------------------------------------------------------------------------

/**
 * Convert OKLCH polar coordinates to linear Display P3 channels.
 * Returns { r, g, b } where each channel is in [0, 1] for in-gamut colors.
 *
 * Pipeline (steps 1-3 identical to oklchToLinearSRGB):
 *   1. OKLCH → OKLab (polar to Cartesian)
 *   2. OKLab → LMS^ (inverse OKLab M1 matrix)
 *   3. LMS^ cube (undo cube-root compression)
 *   4. LMS → linear Display P3 (P3 M2 matrix)
 *
 * The LMS-to-linear-Display-P3 matrix is derived by composing the OKLab
 * LMS→XYZ matrix (inverse of Ottosson M1) with the XYZ D65→Display-P3
 * matrix from the CSS Color 4 specification:
 *   https://www.w3.org/TR/css-color-4/#color-conversion-code
 *
 * Exported for use in isInP3Gamut and tests.
 */
export function oklchToLinearP3(L: number, C: number, h: number): { r: number; g: number; b: number } {
  const hRad = (h * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const lHat = L + 0.3963377774 * a + 0.2158037573 * b;
  const mHat = L - 0.1055613458 * a - 0.0638541728 * b;
  const sHat = L - 0.0894841775 * a - 1.2914855480 * b;

  const lLMS = lHat * lHat * lHat;
  const mLMS = mHat * mHat * mHat;
  const sLMS = sHat * sHat * sHat;

  // Step 4: LMS → linear Display P3
  // Matrix = (XYZ_D65_to_P3) * inv(OKLab_M1_XYZ_to_LMS)
  const r =  3.1281105290 * lLMS - 2.2570750183 * mLMS + 0.1293047883 * sLMS;
  const g = -1.0911281610 * lLMS + 2.4132667618 * mLMS - 0.3221681709 * sLMS;
  const bVal = -0.0260136498 * lLMS - 0.5080276490 * mLMS + 1.5333166822 * sLMS;

  return { r, g, b: bVal };
}

/**
 * Check if an OKLCH color is within the Display P3 gamut (all channels in [0, 1]).
 * Allows a small epsilon for floating point rounding.
 *
 * Exported for use in _deriveChromaCaps and tests.
 */
export function isInP3Gamut(L: number, C: number, h: number, epsilon = 0.001): boolean {
  const { r, g, b } = oklchToLinearP3(L, C, h);
  return (
    r >= -epsilon && r <= 1 + epsilon &&
    g >= -epsilon && g <= 1 + epsilon &&
    b >= -epsilon && b <= 1 + epsilon
  );
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
 * - sRGB derivation: _deriveChromaCaps(tugColorLSamples, isInSRGBGamut, DEFAULT_LC_PARAMS.cMax)
 * - P3 derivation:  _deriveChromaCaps(tugColorLSamples, isInP3Gamut) — no maxCap
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
// TugColor Constants
// ---------------------------------------------------------------------------

/**
 * Lightness at tone=0 (very dark).
 * Source: tug-color-canonical.json `global.l_dark`.
 */
export const L_DARK: number = tugColorCanonical.global.l_dark;

/**
 * Lightness at tone=100 (very light).
 * Source: tug-color-canonical.json `global.l_light`.
 */
export const L_LIGHT: number = tugColorCanonical.global.l_light;

/**
 * Peak chroma scale factor. Peak chroma = MAX_CHROMA_FOR_HUE * PEAK_C_SCALE.
 * At intensity=50, C equals the sRGB-safe max; above 50 pushes into P3.
 */
export const PEAK_C_SCALE = 2;

/**
 * Default canonical L values for all 48 hue families.
 * These are the reference lightness values at intensity=50, tone=50.
 * Must remain above 0.555 (piecewise min() constraint, D04).
 *
 * Derived from tug-color-canonical.json `hues[*].canonical_l`.
 */
export const DEFAULT_CANONICAL_L: Record<string, number> = Object.fromEntries(
  Object.entries(tugColorCanonical.hues).map(([hue, data]) => [hue, data.canonical_l]),
);

/**
 * Five convenience presets per hue. Each preset maps a name to {intensity, tone}.
 * These are labeled reference points in the continuous 100×100 intensity/tone space.
 * Per Table T01 in the plan specification.
 */
export const TUG_COLOR_PRESETS: Record<string, { intensity: number; tone: number }> = {
  canonical: { intensity: 50, tone: 50 },
  light:     { intensity: 20, tone: 85 },
  dark:      { intensity: 50, tone: 20 },
  intense:   { intensity: 90, tone: 50 },
  muted:     { intensity: 50, tone: 42 },
};

// ---------------------------------------------------------------------------
// MAX_CHROMA_FOR_HUE — Per-hue sRGB chroma caps (TugColor L range)
// ---------------------------------------------------------------------------

/**
 * Per-hue maximum chroma for sRGB gamut safety.
 *
 * Hardcoded static table — not computed at runtime.
 * Derived at the per-hue canonical L only (not L_DARK/L_LIGHT extremes):
 *   lSamples(hue) = [DEFAULT_CANONICAL_L[hue]]
 * Binary-searched max chroma at canonical L, 2% safety margin applied,
 * capped at DEFAULT_LC_PARAMS.cMax (0.22).
 *
 * Sampling at only canonical L keeps chroma caps high so canonical colors
 * (intensity=50, tone=50) are vibrant. At extreme tone values (near L_DARK/L_LIGHT),
 * chroma naturally exceeds the narrow gamut at those lightness levels, but
 * CSS oklch() handles this via browser gamut mapping.
 *
 * To regenerate: call _deriveChromaCaps(canonLSamples, isInSRGBGamut, DEFAULT_LC_PARAMS.cMax)
 * where canonLSamples(hue) = [DEFAULT_CANONICAL_L[hue]].
 */
export const MAX_CHROMA_FOR_HUE: Record<string, number> = {
  // --- original 24 ---
  cherry:    0.220,
  coral:     0.220,
  red:       0.220,
  tomato:    0.187,
  flame:     0.165,
  orange:    0.146,
  amber:     0.130,
  gold:      0.125,
  yellow:    0.125,
  lime:      0.192,
  green:     0.220,
  mint:      0.196,
  teal:      0.149,
  cyan:      0.134,
  sky:       0.140,
  blue:      0.143,
  cobalt:    0.135,
  violet:    0.149,
  purple:    0.169,
  plum:      0.161,
  pink:      0.167,
  rose:      0.211,
  magenta:   0.212,
  berry:     0.220,
  // --- new 24 (derived via _deriveChromaCaps at canonical L, capped at 0.22) ---
  garnet:    0.220,
  scarlet:   0.220,
  crimson:   0.220,
  vermilion: 0.220,
  ember:     0.210,
  tangerine: 0.187,
  apricot:   0.174,
  honey:     0.168,
  saffron:   0.169,
  chartreuse:0.190,
  grass:     0.220,
  jade:      0.220,
  seafoam:   0.183,
  aqua:      0.154,
  azure:     0.143,
  cerulean:  0.144,
  sapphire:  0.161,
  indigo:    0.220,
  iris:      0.220,
  grape:     0.220,
  orchid:    0.220,
  peony:     0.220,
  cerise:    0.220,
  fuchsia:   0.220,
};

// ---------------------------------------------------------------------------
// MAX_P3_CHROMA_FOR_HUE — Per-hue Display P3 chroma caps (TugColor L range)
// ---------------------------------------------------------------------------

/**
 * Derive per-hue P3 chroma caps at canonical L only with the Display P3
 * gamut checker and NO maxCap.
 *
 * P3 chroma values exceed their sRGB counterparts because the P3 gamut
 * is strictly wider than sRGB.
 *
 * Not called at runtime. Run once to regenerate MAX_P3_CHROMA_FOR_HUE.
 */
export function _deriveP3ChromaCaps(): Record<string, number> {
  const canonLSamples = (hue: string): number[] => [
    DEFAULT_CANONICAL_L[hue] ?? 0.7,
  ];
  return _deriveChromaCaps(canonLSamples, isInP3Gamut);
}

/**
 * Per-hue maximum chroma for Display P3 gamut safety.
 *
 * Hardcoded static table — not computed at runtime. Derived by calling
 * _deriveP3ChromaCaps() once at canonical L with the isInP3Gamut checker.
 * No maxCap applied — P3 values intentionally exceed sRGB's 0.22.
 *
 * All values are strictly greater than the corresponding MAX_CHROMA_FOR_HUE
 * entries because the P3 gamut is strictly larger than sRGB.
 *
 * To regenerate: call _deriveP3ChromaCaps() and paste the output here.
 */
export const MAX_P3_CHROMA_FOR_HUE: Record<string, number> = {
  // --- original 24 ---
  cherry:    0.275,
  coral:     0.281,
  red:       0.282,
  tomato:    0.236,
  flame:     0.209,
  orange:    0.185,
  amber:     0.163,
  gold:      0.156,
  yellow:    0.153,
  lime:      0.223,
  green:     0.305,
  mint:      0.271,
  teal:      0.202,
  cyan:      0.180,
  sky:       0.168,
  blue:      0.155,
  cobalt:    0.146,
  violet:    0.162,
  purple:    0.184,
  plum:      0.176,
  pink:      0.184,
  rose:      0.280,
  magenta:   0.278,
  berry:     0.303,
  // --- new 24 (derived via _deriveP3ChromaCaps at canonical L) ---
  garnet:    0.288,
  scarlet:   0.282,
  crimson:   0.282,
  vermilion: 0.279,
  ember:     0.237,
  tangerine: 0.213,
  apricot:   0.199,
  honey:     0.193,
  saffron:   0.194,
  chartreuse:0.220,
  grass:     0.263,
  jade:      0.283,
  seafoam:   0.207,
  aqua:      0.179,
  azure:     0.155,
  cerulean:  0.157,
  sapphire:  0.175,
  indigo:    0.248,
  iris:      0.262,
  grape:     0.286,
  orchid:    0.313,
  peony:     0.344,
  cerise:    0.320,
  fuchsia:   0.303,
};

// ---------------------------------------------------------------------------
// ADJACENCY_RING — 48 colors in ascending hue-angle order
// ---------------------------------------------------------------------------

/**
 * Ordered array of all 48 hue family names in ascending OKLCH hue-angle order.
 * Defines ring adjacency: any two consecutive entries (including berry→garnet
 * wrap) may be hyphenated as A-B.
 *
 * Build-time assertion below verifies ascending angle order at module load.
 */
export const ADJACENCY_RING: readonly string[] = [
  "garnet", "cherry", "scarlet", "coral", "crimson", "red",
  "vermilion", "tomato", "ember", "flame", "tangerine", "orange",
  "apricot", "amber", "honey", "gold", "saffron", "yellow",
  "chartreuse", "lime", "grass", "green", "jade", "mint",
  "seafoam", "teal", "aqua", "cyan", "azure", "sky",
  "cerulean", "blue", "sapphire", "cobalt", "indigo", "violet",
  "iris", "purple", "grape", "plum", "orchid", "pink",
  "peony", "rose", "cerise", "magenta", "fuchsia", "berry",
];

// Build-time assertion: ADJACENCY_RING must be in strictly ascending angle order.
for (let _i = 0; _i < ADJACENCY_RING.length - 1; _i++) {
  const _a = HUE_FAMILIES[ADJACENCY_RING[_i]];
  const _b = HUE_FAMILIES[ADJACENCY_RING[_i + 1]];
  if (_a === undefined || _b === undefined || _a >= _b) {
    throw new Error(
      `ADJACENCY_RING order violation: ${ADJACENCY_RING[_i]} (${_a}) >= ${ADJACENCY_RING[_i + 1]} (${_b})`
    );
  }
}

/**
 * Resolve a hyphenated hue pair to a single OKLCH hue angle.
 *
 * Formula: (2/3 * angle(a)) + (1/3 * angle(b)), with circular wrap handling
 * for the berry (355°)–garnet (2.5°) boundary.
 *
 * @param a - Dominant (first) color name — contributes 2/3 of the angle.
 * @param b - Secondary (second) color name — contributes 1/3 of the angle.
 * @returns Resolved hue angle in [0, 360).
 */
export function resolveHyphenatedHue(a: string, b: string): number {
  const angleA = HUE_FAMILIES[a];
  const angleB = HUE_FAMILIES[b];
  if (angleA === undefined || angleB === undefined) {
    throw new Error(`resolveHyphenatedHue: unknown hue name "${angleA === undefined ? a : b}"`);
  }
  // Handle circular wrap for the berry-garnet boundary
  let adjustedB = angleB;
  if (Math.abs(angleA - angleB) > 180) {
    adjustedB = angleB + (angleA > angleB ? 360 : -360);
  }
  return ((2 / 3) * angleA + (1 / 3) * adjustedB + 360) % 360;
}

/**
 * Check if two hue names are adjacent in the ADJACENCY_RING.
 *
 * Two colors are adjacent if their ring positions differ by exactly 1
 * (accounting for the circular wrap: berry and garnet are adjacent).
 *
 * @param a - First color name.
 * @param b - Second color name.
 * @returns True if a and b are consecutive in the ring (either order).
 */
export function isAdjacent(a: string, b: string): boolean {
  const idxA = ADJACENCY_RING.indexOf(a);
  const idxB = ADJACENCY_RING.indexOf(b);
  if (idxA === -1 || idxB === -1) return false;
  const dist = Math.abs(idxA - idxB);
  return dist === 1 || dist === ADJACENCY_RING.length - 1;
}

// ---------------------------------------------------------------------------
// OKLCH_HUE_VOCABULARY — precomputed 144-entry name-to-angle map for reverse lookup
// 48 base names + 96 hyphenated adjacent pairs, built at module load time.
// Used by oklchToTugColor to find the closest named hue expression.
// ---------------------------------------------------------------------------

const OKLCH_HUE_VOCABULARY: Record<string, number> = (() => {
  const vocab: Record<string, number> = { ...HUE_FAMILIES };
  const len = ADJACENCY_RING.length;
  for (let i = 0; i < len; i++) {
    const a = ADJACENCY_RING[i];
    const b = ADJACENCY_RING[(i + 1) % len];
    vocab[`${a}-${b}`] = resolveHyphenatedHue(a, b);
    vocab[`${b}-${a}`] = resolveHyphenatedHue(b, a);
  }
  return vocab;
})();

// ---------------------------------------------------------------------------
// oklchToTugColor — Reverse mapper: oklch() string → TugColor parameters
// ---------------------------------------------------------------------------

/**
 * Parse an `oklch(L C h [/ alpha])` CSS string into its numeric components.
 * Handles optional alpha channel. Returns null if the string does not match.
 */
function parseOklchStr(oklchStr: string): { L: number; C: number; h: number } | null {
  const m = oklchStr.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+)?\s*\)/);
  if (!m) return null;
  return { L: parseFloat(m[1]), C: parseFloat(m[2]), h: parseFloat(m[3]) };
}

/**
 * Reverse-map an `oklch(L C h)` CSS string to the closest TugColor parameters.
 *
 * Algorithm:
 * 1. Parse L, C, h from the oklch string (alpha ignored).
 * 2. If achromatic (C < 0.01), return a neutral gray with intensity=0.
 * 3. Find the closest entry in OKLCH_HUE_VOCABULARY (144 entries: 48 base + 96
 *    hyphenated adjacent pairs). Always returns a named or hyphenated hue.
 * 4. Invert the tone-to-L piecewise formula to recover tone (integer).
 * 5. Compute peakC using the primary color name and invert to recover intensity.
 *
 * @param oklchStr - An `oklch(L C h [/ alpha])` CSS string.
 * @returns `{ hue, intensity, tone }` where hue is a named or hyphenated hue.
 */
export function oklchToTugColor(oklchStr: string): { hue: string; intensity: number; tone: number } {
  const parsed = parseOklchStr(oklchStr);
  if (!parsed) {
    return { hue: "cobalt", intensity: 0, tone: 50 };
  }
  const { L, C, h } = parsed;

  // Step 1: Find closest entry in the 144-entry vocabulary (48 base + 96 hyphenated)
  let closestHue = "cobalt";
  let closestDiff = Infinity;
  for (const [name, angle] of Object.entries(OKLCH_HUE_VOCABULARY)) {
    let diff = Math.abs(h - angle);
    if (diff > 180) diff = 360 - diff;
    if (diff < closestDiff) {
      closestDiff = diff;
      closestHue = name;
    }
  }
  const hue = closestHue;

  // Step 2: Invert tone-to-L piecewise formula using the primary (first) color name.
  // Forward: L = L_DARK + min(tone,50)*(canonL-L_DARK)/50 + max(tone-50,0)*(L_LIGHT-canonL)/50
  const primaryName = hue.split("-")[0];
  const canonicalL = DEFAULT_CANONICAL_L[primaryName] ?? DEFAULT_CANONICAL_L[hue] ?? 0.77;
  const peakC = (MAX_CHROMA_FOR_HUE[primaryName] ?? MAX_CHROMA_FOR_HUE[hue] ?? 0.022) * PEAK_C_SCALE;

  let tone: number;
  if (L <= canonicalL) {
    tone = 50 * (L - L_DARK) / (canonicalL - L_DARK);
  } else {
    tone = 50 + 50 * (L - canonicalL) / (L_LIGHT - canonicalL);
  }
  tone = Math.round(Math.max(0, Math.min(100, tone)));

  // Step 3: Invert intensity-to-C linear formula
  // Forward: C = (intensity/100) * peakC
  const intensity = Math.round(Math.max(0, Math.min(100, (C / peakC) * 100)));

  return { hue, intensity, tone };
}

/**
 * Format an `oklch()` string as a human-readable TugColor description.
 *
 * Examples:
 *   - `"blue intensity=5 tone=13"`
 *   - `"hue-237 intensity=5 tone=13"`
 *
 * @param oklchStr - An `oklch(L C h)` CSS string.
 * @returns A human-readable string like `"blue intensity=5 tone=13"`.
 */
export function tugColorPretty(oklchStr: string): string {
  const { hue, intensity, tone } = oklchToTugColor(oklchStr);
  return `${hue} intensity=${intensity} tone=${tone}`;
}

// ---------------------------------------------------------------------------
// tugColor — TugColor color computation function
// ---------------------------------------------------------------------------

/**
 * Compute an oklch() CSS string from hue name, intensity (0-100), tone (0-100),
 * and canonical lightness.
 *
 * tone → L: piecewise via clamp, matching the CSS calc()+clamp() formula in
 * tug-palette.css exactly. Math.min(tone, 50) ≡ CSS clamp(0, tone, 50), and
 * Math.max(tone - 50, 0) ≡ CSS (clamp(50, tone, 100) - 50).
 *   tone=0   → L_DARK (0.15)
 *   tone=50  → canonicalL
 *   tone=100 → L_LIGHT (0.96)
 *
 * intensity → C: linear from 0 to peakC.
 *   intensity=0   → C=0 (achromatic)
 *   intensity=50  → C = MAX_CHROMA_FOR_HUE * PEAK_C_SCALE / 2 = sRGB max
 *   intensity=100 → C = peakC = MAX_CHROMA_FOR_HUE * PEAK_C_SCALE
 *
 * @param hueName - One of the 24 hue family names in HUE_FAMILIES
 * @param intensity - Intensity axis, 0-100
 * @param tone - Tone axis, 0-100
 * @param canonicalL - Canonical lightness for this hue at intensity=50, tone=50
 * @param peakChroma - Optional peak chroma override. When omitted, defaults to
 *   MAX_CHROMA_FOR_HUE[hueName] * PEAK_C_SCALE (sRGB-derived). When provided,
 *   allows P3-wider chroma (e.g., MAX_P3_CHROMA_FOR_HUE[hueName] * PEAK_C_SCALE).
 * @returns An `oklch(L C h)` CSS string.
 */
export function tugColor(
  hueName: string,
  intensity: number,
  tone: number,
  canonicalL: number,
  peakChroma?: number,
): string {
  const h = HUE_FAMILIES[hueName] ?? 0;
  const maxC = MAX_CHROMA_FOR_HUE[hueName] ?? 0.022;
  const peakC = peakChroma !== undefined ? peakChroma : maxC * PEAK_C_SCALE;

  // tone → L: piecewise via clamp (matches CSS calc()+clamp() formula in tug-palette.css)
  const L = L_DARK
    + Math.min(tone, 50) * (canonicalL - L_DARK) / 50
    + Math.max(tone - 50, 0) * (L_LIGHT - canonicalL) / 50;

  // intensity → C: linear 0 → peakC
  const C = (intensity / 100) * peakC;

  const fmt = (n: number) => parseFloat(n.toFixed(4)).toString();
  return `oklch(${fmt(L)} ${fmt(C)} ${h})`;
}

// ---------------------------------------------------------------------------
// oklchToHex — convert oklch(L, C, h) to a 6-digit hex string
// ---------------------------------------------------------------------------

/**
 * Convert OKLCH components to a 6-digit hex string (#rrggbb).
 *
 * Uses the standard OKLab → linear-sRGB → gamma-sRGB pipeline.
 * Values are clamped to the sRGB gamut.
 */
export function oklchToHex(L: number, C: number, h: number): string {
  // oklch → oklab
  const hRad = h * Math.PI / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // oklab → linear sRGB (via LMS cube roots)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const rLin = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  // linear sRGB → gamma-corrected sRGB
  function gamma(c: number): number {
    return c >= 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
  }

  const rr = Math.round(Math.max(0, Math.min(1, gamma(rLin))) * 255);
  const gg = Math.round(Math.max(0, Math.min(1, gamma(gLin))) * 255);
  const bb = Math.round(Math.max(0, Math.min(1, gamma(bLin))) * 255);

  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(rr)}${hex(gg)}${hex(bb)}`;
}
