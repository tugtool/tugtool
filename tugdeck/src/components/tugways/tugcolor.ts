/**
 * tugcolor — one sensible way to describe color, for designers and developers.
 *
 * The problem with hand-authoring color is that the usual knobs lie. `#3a7bd5`
 * says nothing about how light or how vivid it is; HSL's "saturation" and
 * "lightness" drift wildly between hues (HSL yellow and HSL blue at the same
 * numbers look nothing alike). So you can't reason about a color, and you can't
 * copy one recipe to another hue and trust the result.
 *
 * tugcolor fixes that by standing on OKLCH — a perceptually-uniform space where
 * equal number-steps look like equal perceptual steps — and adding three rules
 * that make it *authorable*:
 *
 *   1. NAME THE HUE.  48 named hues (cherry … berry) map to OKLCH angles. You
 *      pick a hue by name; you never hand-tune an angle. Adjacent hues combine
 *      (`cobalt-indigo`) for the in-between shades.
 *
 *   2. ONE UNIFORM SCALE.  Lightness, chroma, and alpha are each authored as a
 *      plain integer 0–1000. `l: 670` is L 0.67. `a: 800` is 80% opaque.
 *
 *   3. CHROMA IS ABSOLUTE *AND* PORTABLE.  `c` maps linearly onto OKLCH chroma
 *      (0–MAX_CHROMA), then CLAMPS into what the screen (Display-P3) can actually
 *      show. Because the mapping is fixed — not normalized per hue — the SAME `c`
 *      is the same perceived chroma on EVERY hue. So you can copy an `l`/`c` pair
 *      onto a different hue and get the same color, rotated. `c: 1000` always
 *      lands on the punchiest in-gamut color, so you can never author past the
 *      screen, and there's no per-hue saturation table to keep in your head.
 *
 * That's the whole idea. A color is `hue + l + c + a`, and it resolves to a
 * concrete `oklch(...)` CSS string the browser renders device-independently.
 *
 *     tugColor("blue, l: 500, c: 300")      → "oklch(0.5 0.15 230)"
 *     tugColor("blue, l: 500, c: 300, a:800")→ "oklch(0.5 0.15 230 / 0.8)"
 *     tugColor("paper")                      → "oklch(0.868 0 0)"   (a named gray)
 *
 * The math that makes clamping honest (OKLab → linear sRGB/P3, gamut search) is
 * Björn Ottosson's: https://bottosson.github.io/posts/oklab/ . This file has no
 * dependencies — it is the complete model: vocabulary, math, the authoring scale,
 * a parser for the notation, and the resolver. Lift it whole.
 *
 * @module components/tugways/tugcolor
 */

// ===========================================================================
// 1. The authoring scale — 0–1000 integers ↔ OKLCH coordinates
// ===========================================================================

/**
 * OKLCH chroma ceiling. No hue in Display-P3 exceeds this, so it bounds the gamut
 * search — AND it is the authoring ceiling: `c` maps linearly onto 0–MAX_CHROMA,
 * then clamps to the per-hue, per-lightness P3 edge `maxChromaInGamut` finds.
 */
export const MAX_CHROMA = 0.5;

/** Every authored axis (l, c, a) is an integer on this scale. */
export const AUTHOR_MAX = 1000;

/** Lightness / alpha (and all additive deltas): authored integer → oklch fraction. */
export const fracFromAuthored = (n: number): number => n / AUTHOR_MAX;
/** Lightness / alpha (and all additive deltas): oklch fraction → authored integer. */
export const authoredFromFrac = (n: number): number => Math.round(n * AUTHOR_MAX);

/**
 * Absolute, portable chroma: authored 0–1000 maps LINEARLY to oklch C 0–MAX_CHROMA,
 * then clamps into the hue's Display-P3 gamut at (L, hueAngle). The same authored
 * value is the same perceived chroma on EVERY hue — so l/c copy between hues/themes
 * unchanged; `c: 1000` (→ C MAX_CHROMA, above every gamut) always resolves to the
 * punchiest in-gamut color.
 */
export const chromaFromAuthored = (n: number, L: number, hueAngle: number): number =>
  Math.min(fracFromAuthored(n) * MAX_CHROMA, maxChromaInGamut(L, hueAngle, isInP3Gamut));
/**
 * Inverse of chromaFromAuthored: absolute oklch C → authored 0–1000 on the same fixed
 * MAX_CHROMA scale (hue/lightness independent, so it is portable). L/hueAngle are
 * accepted for call-site symmetry but unused — the mapping no longer depends on gamut.
 */
export const authoredFromChroma = (C: number, _L?: number, _hueAngle?: number): number =>
  Math.min(AUTHOR_MAX, Math.max(0, Math.round((C / MAX_CHROMA) * AUTHOR_MAX)));

// ===========================================================================
// 2. The hue vocabulary — 48 named hues, adjacency, and named grays
// ===========================================================================

/** 48 hue family names → OKLCH hue angles (degrees). garnet=2.5 … berry=355. */
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

/**
 * The 48 hue names in ascending hue-angle order. Defines ring adjacency: any two
 * consecutive entries (including the berry→garnet wrap) may be hyphenated as `A-B`.
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
 * Resolve a hyphenated hue pair to one OKLCH angle: (2/3)·angle(a) + (1/3)·angle(b),
 * with circular wrap across the berry(355°)–garnet(2.5°) boundary.
 */
export function resolveHyphenatedHue(a: string, b: string): number {
  const angleA = HUE_FAMILIES[a];
  const angleB = HUE_FAMILIES[b];
  if (angleA === undefined || angleB === undefined) {
    throw new Error(`resolveHyphenatedHue: unknown hue name "${angleA === undefined ? a : b}"`);
  }
  let adjustedB = angleB;
  if (Math.abs(angleA - angleB) > 180) {
    adjustedB = angleB + (angleA > angleB ? 360 : -360);
  }
  return ((2 / 3) * angleA + (1 / 3) * adjustedB + 360) % 360;
}

/**
 * The OKLCH angle for a hue name, or for an adjacency pair when `adjacentName` is
 * given. Returns undefined for non-chromatic names (achromatics, gray, transparent,
 * unknown) — the single source both the resolver and the chroma gamut clamp use.
 */
export function resolveHueAngle(name: string, adjacentName?: string): number | undefined {
  const baseAngle = HUE_FAMILIES[name];
  if (baseAngle === undefined) return undefined;
  return adjacentName ? resolveHyphenatedHue(name, adjacentName) : baseAngle;
}

/** The 9 descriptive named grays (dark → light); fixed lightness lives in ACHROMATIC_L_VALUES. */
export const NAMED_GRAYS: ReadonlySet<string> = new Set([
  "pitch", "ink", "charcoal", "carbon", "graphite", "vellum", "parchment", "linen", "paper",
]);

/** Each achromatic name → its fixed OKLCH L. Endpoints black=0, white=1 are exact. */
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

/** Every name the model understands — the 48 hues, `gray`, the named grays, black/white, transparent. */
export const ALL_TUG_COLOR_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(HUE_FAMILIES),
  "black", "white", "gray", "transparent",
  ...NAMED_GRAYS,
]);

// ===========================================================================
// 3. OKLab ↔ screen — the math that makes "clamp to the gamut" honest
// ===========================================================================

/**
 * OKLCH → linear sRGB channels (each in [0,1] for in-gamut colors).
 * Pipeline per Björn Ottosson's OKLab spec: https://bottosson.github.io/posts/oklab/
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
 * OKLCH → linear Display-P3 channels. Steps 1–3 match oklchToLinearSRGB; step 4 uses
 * the LMS→linear-P3 matrix (OKLab LMS→XYZ composed with XYZ D65→Display-P3, CSS Color 4).
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

/** True if all linear channels lie within [0,1] (allowing a small epsilon). */
function channelsInGamut(c: { r: number; g: number; b: number }, epsilon: number): boolean {
  return (
    c.r >= -epsilon && c.r <= 1 + epsilon &&
    c.g >= -epsilon && c.g <= 1 + epsilon &&
    c.b >= -epsilon && c.b <= 1 + epsilon
  );
}

/** Is an OKLCH color within the sRGB gamut? */
export function isInSRGBGamut(L: number, C: number, h: number, epsilon = 0.001): boolean {
  return channelsInGamut(oklchToLinearSRGB(L, C, h), epsilon);
}

/** Is an OKLCH color within the Display-P3 gamut? */
export function isInP3Gamut(L: number, C: number, h: number, epsilon = 0.001): boolean {
  return channelsInGamut(oklchToLinearP3(L, C, h), epsilon);
}

/** Binary-search the maximum chroma that stays within a gamut at a given L and hue. */
export function maxChromaInGamut(
  L: number,
  h: number,
  gamutCheck: (L: number, C: number, h: number) => boolean,
): number {
  let lo = 0;
  let hi = MAX_CHROMA;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (gamutCheck(L, mid, h)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** OKLCH → "#rrggbb" via OKLab → linear-sRGB → gamma-sRGB, clamped to gamut. */
export function oklchToHex(L: number, C: number, h: number): string {
  const { r: rLin, g: gLin, b: bLin } = oklchToLinearSRGB(L, C, h);
  const gamma = (c: number): number =>
    c >= 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
  const rr = Math.round(Math.max(0, Math.min(1, gamma(rLin))) * 255);
  const gg = Math.round(Math.max(0, Math.min(1, gamma(gLin))) * 255);
  const bb = Math.round(Math.max(0, Math.min(1, gamma(bLin))) * 255);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(rr)}${hex(gg)}${hex(bb)}`;
}

// ===========================================================================
// 4. Resolve — a named color (already in oklch fractions) → numeric OKLCH
// ===========================================================================

/** Numeric OKLCH result with alpha as a 0–1 fraction. */
export interface ResolvedOklch {
  L: number;
  C: number;
  h: number;
  alpha: number;
}

/**
 * Resolve a color to numeric OKLCH. Lightness/chroma/alpha arrive as oklch fractions
 * (chroma already absolute + gamut-clamped via chromaFromAuthored), so this is a
 * hue-angle lookup plus passthrough — the single source of truth the parser, the
 * build plugin, and any audit all resolve through, so output never drifts.
 *
 *   - transparent → fully transparent (l/c ignored)
 *   - black / white → exact endpoints (l/c ignored), alpha honored
 *   - named grays (pitch…paper) → fixed L, C=0
 *   - gray pseudo-hue → achromatic, L from `lightness`
 *   - chromatic hues → angle from name (or hyphenated adjacency), L/C passthrough
 */
export function resolveTugColorToOklch(
  name: string,
  adjacentName: string | undefined,
  lightness: number,
  chroma: number,
  alpha: number,
): ResolvedOklch {
  if (name === "transparent") return { L: 0, C: 0, h: 0, alpha: 0 };
  if (name === "black") return { L: 0, C: 0, h: 0, alpha };
  if (name === "white") return { L: 1, C: 0, h: 0, alpha };
  if (NAMED_GRAYS.has(name)) return { L: ACHROMATIC_L_VALUES[name] ?? 0.5, C: 0, h: 0, alpha };
  if (name === "gray") return { L: lightness, C: 0, h: 0, alpha };
  const h = resolveHueAngle(name, adjacentName);
  if (h === undefined) return { L: lightness, C: 0, h: 0, alpha };
  return { L: lightness, C: chroma, h, alpha };
}

// ===========================================================================
// 5. The editable spec — the designer-facing value (picker / well / editor)
// ===========================================================================

/** A TugColor value: a hue (optionally adjacent) plus oklch l / c / a. */
export interface TugColorSpec {
  hue: string;
  /** Optional adjacency partner — `blue-cobalt`. */
  adjacent?: string;
  /** OKLCH lightness 0–1. */
  l: number;
  /** OKLCH chroma 0–MAX_CHROMA. */
  c: number;
  /** Alpha 0–1 (1 = opaque). */
  a: number;
}

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
export const clampChroma = (n: number): number => Math.max(0, Math.min(MAX_CHROMA, n));

/** Round to 4 decimals, trailing zeros stripped (matches the build formatter). */
const fmt = (n: number): string => parseFloat(n.toFixed(4)).toString();

/** Normalize a spec's axes into range. */
export function normalizeSpec(s: TugColorSpec): TugColorSpec {
  return { hue: s.hue, adjacent: s.adjacent, l: clamp01(s.l), c: clampChroma(s.c), a: clamp01(s.a) };
}

/** A CSS `oklch(...)` string for the spec — adjacency-aware, alpha-honoring. */
export function swatchOklch(s: TugColorSpec): string {
  const r = resolveTugColorToOklch(s.hue, s.adjacent, s.l, s.c, s.a);
  const head = `oklch(${fmt(r.L)} ${fmt(r.C)} ${fmt(r.h)}`;
  return r.alpha >= 1 ? `${head})` : `${head} / ${fmt(r.alpha)})`;
}

/** The hue token as written — `blue` or `blue-cobalt`. */
export function hueText(s: TugColorSpec): string {
  return s.adjacent ? `${s.hue}-${s.adjacent}` : s.hue;
}

/** Value text: `tug(blue, l:300, c:500, a:1000)` — labeled axes in authored 0–1000. */
export function formatTugColorText(s: TugColorSpec): string {
  const L = clamp01(s.l);
  const angle = resolveHueAngle(s.hue, s.adjacent);
  const c = angle === undefined ? 0 : authoredFromChroma(clampChroma(s.c));
  return `tug(${hueText(s)}, l:${authoredFromFrac(L)}, c:${c}, a:${authoredFromFrac(clamp01(s.a))})`;
}

/** Equality on the three axes (+ hue) — used to skip no-op store writes. */
export function specsEqual(a: TugColorSpec, b: TugColorSpec): boolean {
  return a.hue === b.hue && (a.adjacent ?? "") === (b.adjacent ?? "") &&
    a.l === b.l && a.c === b.c && a.a === b.a;
}

// ===========================================================================
// 6. The notation — parse `hue, l: …, c: …, a: …` into a resolved color
// ===========================================================================

/** A color name, optionally with a ring-adjacent partner (hyphenated). */
export interface TugColorValue {
  name: string;
  adjacentName?: string;
}

/** A fully parsed --tug-color() value: name + resolved oklch fractions. */
export interface TugColorParsed {
  color: TugColorValue;
  /** OKLCH lightness 0–1. */
  lightness: number;
  /** OKLCH chroma 0–MAX_CHROMA (absolute, gamut-clamped). */
  chroma: number;
  /** Alpha 0–1. */
  alpha: number;
}

export interface TugColorError { message: string; pos: number; end: number; }
export interface TugColorWarning { message: string; pos: number; end: number; }
export type ParseResult =
  | { ok: true; value: TugColorParsed; warnings?: TugColorWarning[] }
  | { ok: false; errors: TugColorError[] };

const LABELS: Record<string, "lightness" | "chroma" | "alpha"> = {
  l: "lightness", lightness: "lightness",
  c: "chroma", chroma: "chroma",
  a: "alpha", alpha: "alpha",
};

/**
 * Parse the inner text of a `--tug-color(...)` call (everything between the parens).
 *
 * Grammar: a color name (optionally `name-adjacent`), then up to three axes given
 * either labeled (`l: 300`, in any order) or positionally (`300, 500, 800` = l, c, a;
 * positional args must precede labeled ones). Chromatic hues require `l` and `c`;
 * `gray` requires `l`; fixed achromatics take neither. Integers 0–1000 only.
 *
 * Returns the FIRST error with a coarse span — enough for a clear build message.
 * (The original notation parser accumulated every error with precise IDE spans; this
 * trades that tooling for one readable file.)
 */
export function parseTugColor(
  input: string,
  knownHues: ReadonlySet<string>,
  adjacencyRing?: readonly string[],
): ParseResult {
  const fail = (message: string, pos = 0, end = input.length): ParseResult =>
    ({ ok: false, errors: [{ message, pos, end }] });

  const groups = input.split(",").map((g) => g.trim());
  if (groups.length === 0 || groups[0] === "") return fail("Missing required color argument");

  // --- color (group 0) ---
  const colorM = groups[0].toLowerCase().match(/^([a-z]+)(?:-([a-z]+))?$/);
  if (!colorM) return fail(`Expected a color name, got '${groups[0]}'`);
  const name = colorM[1];
  const adjacentName = colorM[2];
  if (!knownHues.has(name)) return fail(`Unknown color '${name}'`);
  if (adjacentName) {
    if (!knownHues.has(adjacentName)) return fail(`Unknown color '${adjacentName}'`);
    if (adjacencyRing) {
      const ia = adjacencyRing.indexOf(name);
      const ib = adjacencyRing.indexOf(adjacentName);
      const adj = ia !== -1 && ib !== -1 &&
        (Math.abs(ia - ib) === 1 || Math.abs(ia - ib) === adjacencyRing.length - 1);
      if (!adj) return fail(`'${name}' and '${adjacentName}' are not adjacent`);
    }
  }

  // --- axes (groups 1+) ---
  const axis: Record<string, number> = {};
  const seen = new Set<string>();
  const POSITIONAL = ["lightness", "chroma", "alpha"] as const;
  let positionalIndex = 0;
  let seenLabeled = false;

  for (let i = 1; i < groups.length; i++) {
    const g = groups[i];
    if (g === "") return fail("Empty argument (extra comma?)");
    const labelM = g.match(/^([a-zA-Z]+)\s*:\s*(.*)$/);
    let slot: "lightness" | "chroma" | "alpha";
    let numText: string;
    if (labelM) {
      seenLabeled = true;
      const resolved = LABELS[labelM[1].toLowerCase()];
      if (!resolved) return fail(`Unknown label '${labelM[1]}'; expected l, c, or a`);
      slot = resolved;
      numText = labelM[2].trim();
    } else {
      if (seenLabeled) return fail("Positional argument after labeled argument");
      const p = POSITIONAL[positionalIndex++];
      if (!p) return fail("Too many arguments; expected at most color, l, c, a");
      slot = p;
      numText = g;
    }
    if (seen.has(slot)) return fail(`Duplicate value for ${slot}`);
    seen.add(slot);
    if (!/^\d+$/.test(numText)) {
      return fail(`Value '${numText}' for ${slot} must be a whole number 0–1000 (e.g. l: 300)`);
    }
    const value = parseInt(numText, 10);
    if (value > AUTHOR_MAX) return fail(`Value ${value} is out of range for ${slot} (0–${AUTHOR_MAX})`);
    axis[slot] = value;
  }

  // --- required-axis rules ---
  const isChromatic = adjacencyRing != null && adjacencyRing.includes(name);
  if (isChromatic) {
    if (axis.lightness === undefined) return fail(`'${name}' requires a lightness value (l:)`);
    if (axis.chroma === undefined) return fail(`'${name}' requires a chroma value (c:)`);
  } else if (name === "gray" && axis.lightness === undefined) {
    return fail("'gray' requires a lightness value (l:)");
  }

  // --- resolve to oklch fractions ---
  const lightness = fracFromAuthored(axis.lightness ?? 0);
  const angle = resolveHueAngle(name, adjacentName);
  const chroma = angle === undefined ? 0 : chromaFromAuthored(axis.chroma ?? 0, lightness, angle);
  const alpha = fracFromAuthored(axis.alpha ?? AUTHOR_MAX);

  // --- soft warnings for ignored axes on achromatics ---
  const warnings: TugColorWarning[] = [];
  const span = { pos: 0, end: input.length };
  const isFixedAchromatic = !isChromatic && name !== "gray" && name !== "transparent";
  if (name === "transparent" && (seen.size > 0)) {
    warnings.push({ message: "all arguments are ignored for 'transparent'", ...span });
  } else if (isFixedAchromatic) {
    if (seen.has("lightness")) warnings.push({ message: `lightness is ignored for '${name}' (fixed lightness)`, ...span });
    if (seen.has("chroma")) warnings.push({ message: `chroma is ignored for '${name}' (always C=0)`, ...span });
  } else if (name === "gray" && seen.has("chroma")) {
    warnings.push({ message: "chroma is ignored for 'gray' (always C=0)", ...span });
  }

  const value: TugColorParsed = { color: { name, adjacentName }, lightness, chroma, alpha };
  return warnings.length > 0 ? { ok: true, value, warnings } : { ok: true, value };
}

/** A `--tug-color(...)` call found within a larger CSS value string. */
export interface TugColorCallSpan {
  /** Index of the first '-' in '--tug-color(' */
  start: number;
  /** Index one past the closing ')' */
  end: number;
  /** The text between the parentheses (excluding them) */
  inner: string;
}

/** Result of findTugColorCallsWithWarnings — calls plus any unmatched-paren warnings. */
export interface FindCallsResult {
  calls: TugColorCallSpan[];
  warnings: TugColorWarning[];
}

const TUG_COLOR_MARKER = "--tug-color(";

/**
 * Find all `--tug-color()` calls in a CSS value, returning the calls plus warnings
 * for any unmatched parens. Handles nesting (calc(), linear-gradient(), …) correctly.
 */
export function findTugColorCallsWithWarnings(cssValue: string): FindCallsResult {
  const calls: TugColorCallSpan[] = [];
  const warnings: TugColorWarning[] = [];
  let searchFrom = 0;

  while (searchFrom < cssValue.length) {
    const start = cssValue.indexOf(TUG_COLOR_MARKER, searchFrom);
    if (start === -1) break;

    const innerStart = start + TUG_COLOR_MARKER.length;
    let depth = 1;
    let i = innerStart;
    while (i < cssValue.length && depth > 0) {
      if (cssValue[i] === "(") depth++;
      else if (cssValue[i] === ")") depth--;
      i++;
    }

    if (depth !== 0) {
      warnings.push({ message: "Unmatched parenthesis in --tug-color() call", pos: start, end: cssValue.length });
      searchFrom = innerStart;
      continue;
    }

    calls.push({ start, end: i, inner: cssValue.slice(innerStart, i - 1) });
    searchFrom = i;
  }

  return { calls, warnings };
}

/** Find all `--tug-color()` calls in a CSS value (call spans only). */
export function findTugColorCalls(cssValue: string): TugColorCallSpan[] {
  return findTugColorCallsWithWarnings(cssValue).calls;
}

// ===========================================================================
// 7. tugColor() — the one-call convenience: notation → oklch() string
// ===========================================================================

/**
 * Resolve a `--tug-color()` notation string to a concrete `oklch(...)` CSS string.
 * The self-contained entry point — `tugColor("blue, l: 500, c: 300")`. Throws on a
 * parse error. (The build pipeline uses the parts above directly; this is the
 * friendly front door for anyone lifting this file.)
 */
export function tugColor(notation: string): string {
  const inner = notation.trim().replace(/^--tug-color\(/, "").replace(/\)$/, "");
  const result = parseTugColor(inner, ALL_TUG_COLOR_NAMES, ADJACENCY_RING);
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "invalid --tug-color()");
  const { color, lightness, chroma, alpha } = result.value;
  const { L, C, h, alpha: a } = resolveTugColorToOklch(color.name, color.adjacentName, lightness, chroma, alpha);
  const head = `oklch(${fmt(L)} ${fmt(C)} ${fmt(h)}`;
  return a < 1 ? `${head} / ${fmt(a)})` : `${head})`;
}
