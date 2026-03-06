/**
 * Palette Engine — Tugways Phase 5d5a
 *
 * Computes a continuous OKLCH color palette from 24 named hue families.
 * Uses a smoothstep transfer function mapping intensity 0–100 to OKLCH L and C.
 * Per-hue chroma caps prevent sRGB gamut clipping at all standard stops.
 * Injects all palette CSS variables into a <style id="tug-palette"> element.
 *
 * Public API surface: see Spec S01 (#s01-core-functions).
 *
 * CSS variable format: --tug-palette-hue-<angle>-<name>-tone-<intensity>
 * Named aliases:       --tug-palette-hue-<angle>-<name>-<alias>
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
// LCParams — Transfer function anchor parameters
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
// TONE_ALIASES — Named tone alias mappings
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
// Standard stops
// ---------------------------------------------------------------------------

/** The 11 standard intensity stops (Spec S03). */
const STANDARD_STOPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

// ---------------------------------------------------------------------------
// Transfer function — smoothstep
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
// OKLCH → sRGB conversion (private, for gamut validation)
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
 */
function oklchToLinearSRGB(L: number, C: number, h: number): { r: number; g: number; b: number } {
  // Step 1: OKLCH polar → OKLab Cartesian
  const hRad = (h * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // Step 2: OKLab → LMS^ (via inverse OKLab M1 matrix)
  // l^ = L + 0.3963377774 * a + 0.2158037573 * b
  // m^ = L - 0.1055613458 * a - 0.0638541728 * b
  // s^ = L - 0.0894841775 * a - 1.2914855480 * b
  const lHat = L + 0.3963377774 * a + 0.2158037573 * b;
  const mHat = L - 0.1055613458 * a - 0.0638541728 * b;
  const sHat = L - 0.0894841775 * a - 1.2914855480 * b;

  // Step 3: Undo cube-root compression (LMS^ → LMS)
  const lLMS = lHat * lHat * lHat;
  const mLMS = mHat * mHat * mHat;
  const sLMS = sHat * sHat * sHat;

  // Step 4: LMS → linear sRGB (M2 matrix)
  //  r =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  //  g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  //  b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  const r =  4.0767416621 * lLMS - 3.3077115913 * mLMS + 0.2309699292 * sLMS;
  const g = -1.2684380046 * lLMS + 2.6097574011 * mLMS - 0.3413193965 * sLMS;
  const bVal = -0.0041960863 * lLMS - 0.7034186147 * mLMS + 1.7076147010 * sLMS;

  return { r, g, b: bVal };
}

/**
 * Check if an OKLCH color is within the sRGB gamut (all channels in [0, 1]).
 * Allows a small epsilon for floating point rounding.
 */
function isInSRGBGamut(L: number, C: number, h: number, epsilon = 0.001): boolean {
  const { r, g, b } = oklchToLinearSRGB(L, C, h);
  return (
    r >= -epsilon && r <= 1 + epsilon &&
    g >= -epsilon && g <= 1 + epsilon &&
    b >= -epsilon && b <= 1 + epsilon
  );
}

/**
 * Find the maximum chroma at a given L and hue angle that stays in sRGB gamut.
 * Binary search in [0, maxSearch] with given precision.
 */
function findMaxChroma(L: number, h: number, maxSearch = 0.4, steps = 32): number {
  let lo = 0;
  let hi = maxSearch;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (isInSRGBGamut(L, mid, h)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // Apply a small safety margin
  return lo * 0.98;
}

// ---------------------------------------------------------------------------
// MAX_CHROMA_FOR_HUE — Per-hue chroma caps (hardcoded static table, [D02])
// ---------------------------------------------------------------------------

/**
 * Regeneration helper (not called at runtime).
 *
 * Run this function once to recompute the MAX_CHROMA_FOR_HUE table when
 * DEFAULT_LC_PARAMS changes.  The results are pasted into the literal table
 * below.  Derivation: binary-search the maximum chroma at both L_MIN and the
 * midpoint L (≈0.69), take the minimum across both, and apply a 2% safety
 * margin.  All values are capped at DEFAULT_LC_PARAMS.cMax (0.22).
 *
 * Per decision [D02]: per-hue chroma caps are a static constant table, not
 * computed at runtime, so injection latency is unaffected.
 */
function _deriveChromaCaps(): Record<string, number> {
  const caps: Record<string, number> = {};
  const L = DEFAULT_LC_PARAMS.lMin;
  for (const [name, angle] of Object.entries(HUE_FAMILIES)) {
    const capAtLMin = findMaxChroma(L, angle);
    const capAtMid = findMaxChroma(0.69, angle);
    const cap = Math.min(capAtLMin, capAtMid, DEFAULT_LC_PARAMS.cMax);
    caps[name] = Math.round(cap * 1000) / 1000;
  }
  return caps;
}

/**
 * Per-hue maximum chroma for sRGB gamut safety.
 *
 * Hardcoded static table per decision [D02] — not computed at runtime.
 * Values were derived by running _deriveChromaCaps() once with the binary-
 * search gamut checker against DEFAULT_LC_PARAMS (L_MIN=0.42, L_MID≈0.69).
 * Each cap is the minimum safe chroma across all standard stops for that hue,
 * with a 2% safety margin, capped at cMax=0.22.
 *
 * To regenerate: call _deriveChromaCaps() and paste the output here.
 */
export const MAX_CHROMA_FOR_HUE: Record<string, number> = {
  cherry:  0.167,
  red:     0.169,
  tomato:  0.147,
  flame:   0.120,
  orange:  0.104,
  amber:   0.094,
  gold:    0.089,
  yellow:  0.086,
  lime:    0.095,
  green:   0.135,
  mint:    0.103,
  teal:    0.079,
  cyan:    0.071,
  sky:     0.074,
  blue:    0.083,
  indigo:  0.118,
  violet:  0.159,
  purple:  0.167,
  plum:    0.189,
  pink:    0.200,
  rose:    0.185,
  magenta: 0.177,
  crimson: 0.171,
  coral:   0.167,
};

// ---------------------------------------------------------------------------
// Core palette functions
// ---------------------------------------------------------------------------

/**
 * Build a clamped oklch() CSS string from raw L, C, and hue name.
 * Clamps C to min(C, MAX_CHROMA_FOR_HUE[hueName]).
 *
 * Composable helper: callers supply their own L/C values (e.g., from an
 * alternative transfer function) and get chroma capping + string formatting
 * without reimplementing either.
 */
export function clampedOklchString(hueName: string, L: number, C: number): string {
  const maxC = MAX_CHROMA_FOR_HUE[hueName] ?? DEFAULT_LC_PARAMS.cMax;
  const clampedC = Math.min(C, maxC);
  const angle = HUE_FAMILIES[hueName] ?? 0;
  // Format to 4 decimal places for precision, trim trailing zeros
  const fmtNum = (n: number) => parseFloat(n.toFixed(4)).toString();
  return `oklch(${fmtNum(L)} ${fmtNum(clampedC)} ${angle})`;
}

/**
 * Compute an oklch() CSS color string for a given hue and intensity.
 * Clamps intensity to [0, 100]. Applies per-hue chroma cap.
 * Uses the default smoothstep transfer function internally.
 */
export function tugPaletteColor(hueName: string, intensity: number, params?: LCParams): string {
  const p = params ?? DEFAULT_LC_PARAMS;
  const { L, C } = intensityToLC(intensity, p);
  return clampedOklchString(hueName, L, C);
}

/**
 * Return the CSS custom property name for a palette color.
 * Format: --tug-palette-hue-<angle>-<name>-tone-<intensity>
 */
export function tugPaletteVarName(hueName: string, intensity: number): string {
  const angle = HUE_FAMILIES[hueName] ?? 0;
  return `--tug-palette-hue-${angle}-${hueName}-tone-${intensity}`;
}

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------

/** The id of the injected palette style element. */
const PALETTE_STYLE_ID = "tug-palette";

/**
 * Read theme parameter overrides from computed styles on document.body.
 * Falls back to DEFAULT_LC_PARAMS when properties are absent.
 */
function readThemeParams(): LCParams {
  // Guard for non-browser environments (tests without DOM)
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
 * Read per-hue angle overrides from computed styles on document.body.
 * Returns a map of hue name to angle (merged with HUE_FAMILIES defaults).
 */
function readHueOverrides(): Record<string, number> {
  const result: Record<string, number> = { ...HUE_FAMILIES };
  if (typeof document === "undefined") return result;
  const cs = getComputedStyle(document.body);
  for (const name of Object.keys(HUE_FAMILIES)) {
    const raw = cs.getPropertyValue(`--tug-theme-hue-${name}`).trim();
    if (raw) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) {
        result[name] = parsed;
      }
    }
  }
  return result;
}

/**
 * Inject all palette CSS variables into a <style id="tug-palette"> element.
 *
 * Injects:
 * - 264 numeric stop variables (24 hues × 11 stops: 0,10,20,...,100)
 * - 96 named tone alias variables (24 hues × 4 aliases: soft/default/strong/intense)
 * Total: 360 variables
 *
 * Reads theme parameter overrides from getComputedStyle(document.body).
 * Idempotent: replaces existing element content if already present.
 */
export function injectPaletteCSS(_themeName: string): void {
  if (typeof document === "undefined") return;

  const params = readThemeParams();
  const hueOverrides = readHueOverrides();

  const lines: string[] = [":root {"];

  for (const [name, _defaultAngle] of Object.entries(HUE_FAMILIES)) {
    const angle = hueOverrides[name] ?? _defaultAngle;

    // Shared formatting helper for this hue
    const fmtNum = (n: number) => parseFloat(n.toFixed(4)).toString();
    const makeOklch = (intensity: number): string => {
      const { L, C } = intensityToLC(intensity, params);
      const maxC = MAX_CHROMA_FOR_HUE[name] ?? params.cMax;
      const clampedC = Math.min(C, maxC);
      return `oklch(${fmtNum(L)} ${fmtNum(clampedC)} ${angle})`;
    };

    // Numeric stops
    for (const stop of STANDARD_STOPS) {
      lines.push(`  --tug-palette-hue-${angle}-${name}-tone-${stop}: ${makeOklch(stop)};`);
    }

    // Named tone aliases (soft=15, default=50, strong=75, intense=100)
    for (const [alias, intensity] of Object.entries(TONE_ALIASES)) {
      lines.push(`  --tug-palette-hue-${angle}-${name}-${alias}: ${makeOklch(intensity)};`);
    }
  }

  lines.push("}");
  const css = lines.join("\n");

  // Create or replace the palette style element
  let styleEl = document.getElementById(PALETTE_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = PALETTE_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}
