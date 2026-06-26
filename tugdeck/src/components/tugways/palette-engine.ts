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

/**
 * Check if two hue names are adjacent in the ADJACENCY_RING (distance 1, with wrap).
 */
export function isAdjacent(a: string, b: string): boolean {
  const idxA = ADJACENCY_RING.indexOf(a);
  const idxB = ADJACENCY_RING.indexOf(b);
  if (idxA === -1 || idxB === -1) return false;
  const dist = Math.abs(idxA - idxB);
  return dist === 1 || dist === ADJACENCY_RING.length - 1;
}

// ---------------------------------------------------------------------------
// Named Grays — fixed-lightness achromatic values
// ---------------------------------------------------------------------------

/**
 * Named gray tone mapping: descriptive name → its position label (10–90), kept so
 * callers can enumerate the named grays. The actual lightness is in ACHROMATIC_L_VALUES.
 */
export const NAMED_GRAYS: Record<string, number> = {
  pitch:     10,
  ink:       20,
  charcoal:  30,
  carbon:    40,
  graphite:  50,
  vellum:    60,
  parchment: 70,
  linen:     80,
  paper:     90,
};

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
  if (NAMED_GRAYS[name] !== undefined) {
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
