/**
 * Palette Engine — Tugways TugColor Runtime
 *
 * `--tug-color()` is thin sugar over `oklch()`: a color is a named hue plus OKLCH
 * lightness, chroma, and alpha carried through directly. This module owns the hue
 * vocabulary (48 named hues → angles), the named grays, and `resolveTugColorToOklch`
 * — the single source of truth the postcss plugin and the CLI contrast audit both
 * resolve through, so build output and audit never drift.
 *
 * Hyphenated adjacency: any two adjacent hues in ADJACENCY_RING may be combined as
 * `A-B`, resolving to (2/3)*angle(A) + (1/3)*angle(B).
 *
 * Named grays: the 9 intermediate achromatic values use descriptive names (pitch
 * through paper, dark to light) with fixed OKLCH L; `ACHROMATIC_L_VALUES` maps each
 * (including black and white) to its L.
 *
 * @module components/tugways/palette-engine
 */

/**
 * OKLCH chroma ceiling — the oklch C that authored chroma 1000 maps to. Chroma's
 * 0–1000 authoring range spans 0–MAX_CHROMA, chosen as headroom above the most
 * saturated authored color (themes top out near c≈620, oklch C≈0.31).
 *
 * NOTE: 0.5 is NOT a gamut boundary. The in-gamut chroma ceiling is hue- and
 * lightness-dependent (≈c270–c570 at mid lightness) and always below 1000, so the
 * upper part of the range is out of gamut and the browser gamut-maps it. A single
 * linear scale cannot make the whole 0–1000 range in-gamut — only a per-hue,
 * per-lightness remap could, and that is exactly the "intensity" model this system
 * deliberately retired (see color-palette.md history). The audit:gamut script
 * reports where authored values cross the real P3 ceiling.
 */
export const MAX_CHROMA = 0.5;

// ---------------------------------------------------------------------------
// Authoring scale — the ONE place --tug-color()'s 0–1000 axes convert to/from oklch
// ---------------------------------------------------------------------------

/**
 * --tug-color() authors lightness, chroma, and alpha as integers 0–AUTHOR_MAX.
 * Lightness and alpha map linearly onto the full 0–1 oklch axis; chroma maps onto
 * 0–MAX_CHROMA (the top of the chroma range exceeds the in-gamut ceiling for every
 * hue — see MAX_CHROMA). These four functions are the single
 * definition of that scale — the parser, the serializers, the picker/adjustment,
 * the theme editor, and the gamut scripts all route through them, so no module
 * carries its own copy of the arithmetic.
 */
export const AUTHOR_MAX = 1000;

/** Lightness or alpha: authored integer → oklch fraction. */
export const fracFromAuthored = (n: number): number => n / AUTHOR_MAX;
/** Lightness or alpha: oklch fraction → authored integer. */
export const authoredFromFrac = (n: number): number => Math.round(n * AUTHOR_MAX);
/** Chroma: authored integer → oklch C (0–MAX_CHROMA). */
export const chromaFromAuthored = (n: number): number => (n / AUTHOR_MAX) * MAX_CHROMA;
/** Chroma: oklch C → authored integer. */
export const authoredFromChroma = (n: number): number => Math.round((n / MAX_CHROMA) * AUTHOR_MAX);

// ---------------------------------------------------------------------------
// HUE_FAMILIES — 48 named hue families mapped to OKLCH hue angles
// ---------------------------------------------------------------------------

/**
 * 48 hue family names mapped to OKLCH hue angles (degrees).
 * garnet=2.5 through berry=355.
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
// ADJACENCY_RING — 48 colors in ascending hue-angle order
// ---------------------------------------------------------------------------

/**
 * Ordered array of all 48 hue family names in ascending OKLCH hue-angle order.
 * Defines ring adjacency: any two consecutive entries (including berry→garnet
 * wrap) may be hyphenated as A-B.
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

// ---------------------------------------------------------------------------
// Named Grays — fixed-lightness achromatic values
// ---------------------------------------------------------------------------

/**
 * The 9 descriptive named grays (dark to light). Each name's fixed lightness is in
 * ACHROMATIC_L_VALUES; this set is the membership check / enumeration source.
 */
export const NAMED_GRAYS: ReadonlySet<string> = new Set([
  "pitch", "ink", "charcoal", "carbon", "graphite", "vellum", "parchment", "linen", "paper",
]);

/**
 * Mapping from each achromatic name to its fixed OKLCH L value.
 * Endpoints black=0 and white=1 are exact.
 */
export const ACHROMATIC_L_VALUES: Record<string, number> = {
  black:     0,
  pitch:     0.22,
  ink:       0.29,
  charcoal:  0.36,
  carbon:    0.43,
  graphite:  0.5,
  vellum:    0.592,
  parchment: 0.684,
  linen:     0.776,
  paper:     0.868,
  white:     1,
};

// ---------------------------------------------------------------------------
// resolveTugColorToOklch — numeric --tug-color() resolution (single source of truth)
// ---------------------------------------------------------------------------

/** Numeric OKLCH result with alpha as a 0–1 fraction. */
export interface ResolvedOklch {
  L: number;
  C: number;
  h: number;
  /** Alpha as a fraction in [0, 1]. */
  alpha: number;
}

/**
 * Resolve a parsed --tug-color() value to numeric OKLCH components.
 *
 * `--tug-color()` carries OKLCH lightness/chroma/alpha directly, so this is little
 * more than a hue-angle lookup plus passthrough. The build plugin formats the result
 * into `oklch(...)`; the CLI contrast audit feeds it straight into the WCAG/perceptual
 * checks, so build output and audit never drift.
 *
 * Resolution:
 *   - transparent → fully transparent black (l/c ignored).
 *   - black / white → exact endpoints (l/c ignored), alpha honored.
 *   - Named grays (pitch…paper) → fixed L, C=0 (l/c ignored), alpha honored.
 *   - gray pseudo-hue → achromatic, L from `lightness`, C=0.
 *   - Chromatic hues → angle from the hue name (or hyphenated adjacency), L/C from
 *     `lightness`/`chroma`.
 *
 * @param name - Primary hue/keyword (bare name, achromatic name, or "gray"/"transparent").
 * @param adjacentName - Second name for hyphenated chromatic adjacency, else undefined.
 * @param lightness - OKLCH lightness 0–1.
 * @param chroma - OKLCH chroma 0–~0.4.
 * @param alpha - Alpha 0–1.
 */
export function resolveTugColorToOklch(
  name: string,
  adjacentName: string | undefined,
  lightness: number,
  chroma: number,
  alpha: number,
): ResolvedOklch {
  // transparent
  if (name === "transparent") return { L: 0, C: 0, h: 0, alpha: 0 };

  // black / white
  if (name === "black") return { L: 0, C: 0, h: 0, alpha };
  if (name === "white") return { L: 1, C: 0, h: 0, alpha };

  // Named grays (pitch through paper) — fixed L, achromatic
  if (NAMED_GRAYS.has(name)) {
    return { L: ACHROMATIC_L_VALUES[name] ?? 0.5, C: 0, h: 0, alpha };
  }

  // gray pseudo-hue — achromatic, arbitrary L
  if (name === "gray") {
    return { L: lightness, C: 0, h: 0, alpha };
  }

  // Chromatic hues — angle from the name (or adjacency); l/c passthrough.
  const baseAngle = HUE_FAMILIES[name];
  if (baseAngle === undefined) return { L: lightness, C: 0, h: 0, alpha };
  const h = adjacentName ? resolveHyphenatedHue(name, adjacentName) : baseAngle;
  return { L: lightness, C: chroma, h, alpha };
}

// ---------------------------------------------------------------------------
// OKLCH → sRGB conversions (used by the contrast / CVD analysis)
// ---------------------------------------------------------------------------

/**
 * Convert OKLCH polar coordinates to linear sRGB channels (each in [0, 1] for
 * in-gamut colors). Pipeline per Björn Ottosson's OKLab spec:
 *   https://bottosson.github.io/posts/oklab/
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
 * Convert OKLCH polar coordinates to linear Display P3 channels (each in [0, 1] for
 * in-gamut colors). Steps 1–3 match oklchToLinearSRGB; step 4 uses the LMS→linear-P3
 * matrix (OKLab LMS→XYZ composed with XYZ D65→Display-P3, CSS Color 4).
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

  const r =  3.1281105290 * lLMS - 2.2570750183 * mLMS + 0.1293047883 * sLMS;
  const g = -1.0911281610 * lLMS + 2.4132667618 * mLMS - 0.3221681709 * sLMS;
  const bVal = -0.0260136498 * lLMS - 0.5080276490 * mLMS + 1.5333166822 * sLMS;

  return { r, g, b: bVal };
}

/** True if all linear channels lie within [0, 1] (allowing a small epsilon). */
function channelsInGamut(c: { r: number; g: number; b: number }, epsilon: number): boolean {
  return (
    c.r >= -epsilon && c.r <= 1 + epsilon &&
    c.g >= -epsilon && c.g <= 1 + epsilon &&
    c.b >= -epsilon && c.b <= 1 + epsilon
  );
}

/** Check if an OKLCH color is within the sRGB gamut. */
export function isInSRGBGamut(L: number, C: number, h: number, epsilon = 0.001): boolean {
  return channelsInGamut(oklchToLinearSRGB(L, C, h), epsilon);
}

/** Check if an OKLCH color is within the Display P3 gamut. */
export function isInP3Gamut(L: number, C: number, h: number, epsilon = 0.001): boolean {
  return channelsInGamut(oklchToLinearP3(L, C, h), epsilon);
}

/**
 * Binary-search the maximum chroma that stays within a gamut at a given L and hue.
 * Used by the gamut audit to report how far an out-of-gamut color overshoots.
 */
export function maxChromaInGamut(
  L: number,
  h: number,
  gamutCheck: (L: number, C: number, h: number) => boolean,
): number {
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (gamutCheck(L, mid, h)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Convert OKLCH components to a 6-digit hex string (#rrggbb).
 * Uses the standard OKLab → linear-sRGB → gamma-sRGB pipeline, clamped to gamut.
 */
export function oklchToHex(L: number, C: number, h: number): string {
  const { r: rLin, g: gLin, b: bLin } = oklchToLinearSRGB(L, C, h);

  function gamma(c: number): number {
    return c >= 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
  }

  const rr = Math.round(Math.max(0, Math.min(1, gamma(rLin))) * 255);
  const gg = Math.round(Math.max(0, Math.min(1, gamma(gLin))) * 255);
  const bb = Math.round(Math.max(0, Math.min(1, gamma(bLin))) * 255);

  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(rr)}${hex(gg)}${hex(bb)}`;
}
