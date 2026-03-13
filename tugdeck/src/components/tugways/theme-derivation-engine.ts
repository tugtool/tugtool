/**
 * Theme Derivation Engine — Tugways Theme Generator
 *
 * Derives complete 264-token `--tug-base-*` themes from a compact `ThemeRecipe`.
 * Each call to `deriveTheme()` returns:
 *   - `tokens`: all 264 token values as `--tug-color()` strings (for CSS export)
 *   - `resolved`: OKLCH values for all chromatic tokens (for contrast checking / CVD)
 *
 * The derivation follows ~55 role formulas extracted from the three hand-authored
 * themes (Brio, Bluenote, Harmony). Mood knobs (`surfaceContrast`, `signalVividity`,
 * `warmth`) modulate tone spreads and intensity levels.
 *
 * [D01] Export format — tokens map matches bluenote.css / harmony.css structure
 * [D04] ThemeRecipe interface from proposal
 * [D08] Scope: --tug-base-* tokens only (264 tokens)
 * [D09] Dual output: string tokens + resolved OKLCH map
 *
 * @module components/tugways/theme-derivation-engine
 */

import {
  HUE_FAMILIES,
  DEFAULT_CANONICAL_L,
  MAX_CHROMA_FOR_HUE,
  PEAK_C_SCALE,
  L_DARK,
  L_LIGHT,
  isInSRGBGamut,
} from "./palette-engine";

// ---------------------------------------------------------------------------
// Public interfaces — Spec S01 / S02
// ---------------------------------------------------------------------------

/**
 * Compact recipe input. Minimum 3 values (mode + atmosphere + text);
 * full control with ~12. Spec S01.
 */
export interface ThemeRecipe {
  name: string;
  mode: "dark" | "light";
  atmosphere: { hue: string; offset?: number };
  text: { hue: string; offset?: number };
  accent?: string;
  primary?: string;
  destructive?: string;
  success?: string;
  caution?: string;
  info?: string;
  surfaceContrast?: number; // 0-100, default 50
  signalVividity?: number; // 0-100, default 50
  warmth?: number; // 0-100, default 50
}

/**
 * Resolved OKLCH value for a single token. Spec S02.
 */
export interface ResolvedColor {
  L: number;
  C: number;
  h: number;
  alpha: number; // 0-1
}

/**
 * Contrast result for a fg/bg pair. Spec S02.
 * Populated by the accessibility module (Step 3).
 */
export interface ContrastResult {
  fg: string;
  bg: string;
  wcagRatio: number;
  apcaLc: number;
  wcagPass: boolean;
  role: "body-text" | "large-text" | "ui-component" | "decorative";
}

/**
 * CVD warning for a token pair. Spec S02.
 * Populated by the CVD simulation module (Step 5).
 */
export interface CVDWarning {
  type: "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";
  tokenPair: [string, string];
  description: string;
  suggestion: string;
}

/**
 * Output from deriveTheme(). Spec S02.
 * contrastResults and cvdWarnings are populated in later steps.
 */
export interface ThemeOutput {
  name: string;
  mode: "dark" | "light";
  tokens: Record<string, string>;
  resolved: Record<string, ResolvedColor>;
  contrastResults: ContrastResult[];
  cvdWarnings: CVDWarning[];
}

// ---------------------------------------------------------------------------
// EXAMPLE_RECIPES — three reference recipes from the proposal
// ---------------------------------------------------------------------------

/**
 * Reference recipes for Brio (default dark), Bluenote (cool dark),
 * and Harmony (warm light). From roadmap/theme-generator-proposal.md [D04].
 */
export const EXAMPLE_RECIPES: Record<string, ThemeRecipe> = {
  brio: {
    name: "brio",
    mode: "dark",
    atmosphere: { hue: "violet", offset: -6 },
    text: { hue: "cobalt" },
  },
  bluenote: {
    name: "bluenote",
    mode: "dark",
    atmosphere: { hue: "blue", offset: 9 },
    text: { hue: "blue" },
  },
  harmony: {
    name: "harmony",
    mode: "light",
    atmosphere: { hue: "yellow" },
    text: { hue: "blue", offset: 5 },
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective hue angle for a seed: named hue + optional degree offset.
 * Returns the hue angle in degrees (0-360).
 */
function resolveHueAngle(hue: string, offset = 0): number {
  const base = HUE_FAMILIES[hue] ?? 250; // fallback to cobalt
  return (base + offset + 360) % 360;
}

/**
 * Find the closest named hue in HUE_FAMILIES to a given angle (degrees).
 * Returns the name string.
 */
function closestHueName(angle: number): string {
  let best = "violet";
  let bestDiff = Infinity;
  for (const [name, h] of Object.entries(HUE_FAMILIES)) {
    let diff = Math.abs(angle - h);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = name;
    }
  }
  return best;
}

/**
 * Format a hue reference with optional integer degree offset.
 * Produces the shortest valid form matching postcss-tug-color syntax:
 *   "blue", "blue+9", "blue-6", "blue+5"
 *
 * The offset is the degree difference from the named hue's base angle,
 * rounded to the nearest integer. If the offset rounds to 0, omit it.
 */
function formatHueRef(namedHue: string, targetAngle: number): string {
  const baseAngle = HUE_FAMILIES[namedHue] ?? 0;
  let diff = targetAngle - baseAngle;
  // Normalize to [-180, 180]
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  const rounded = Math.round(diff);
  if (rounded === 0) return namedHue;
  if (rounded > 0) return `${namedHue}+${rounded}`;
  return `${namedHue}${rounded}`; // negative: e.g. "violet-6"
}

/**
 * Compute OKLCH from hue angle, intensity (0-100), tone (0-100).
 * Uses the same formula as tugColor() in palette-engine.ts.
 */
function resolveOklch(
  hueAngle: number,
  intensity: number,
  tone: number,
  hueName?: string,
): { L: number; C: number; h: number } {
  const name = hueName ?? closestHueName(hueAngle);
  const canonL = DEFAULT_CANONICAL_L[name] ?? 0.77;
  const maxC = MAX_CHROMA_FOR_HUE[name] ?? 0.135;
  const peakC = maxC * PEAK_C_SCALE;

  const L =
    L_DARK +
    (Math.min(tone, 50) * (canonL - L_DARK)) / 50 +
    (Math.max(tone - 50, 0) * (L_LIGHT - canonL)) / 50;

  const C = (intensity / 100) * peakC;
  return { L, C, h: hueAngle };
}

/**
 * Build a `--tug-color()` string in the most compact valid form.
 *
 * Compact rules (per plan task):
 *   - i=50, t=50, a=100 → `--tug-color(hue)` (canonical, bare)
 *   - Preset match (light/dark/intense/muted) → `--tug-color(hue-preset)`
 *   - Otherwise: `--tug-color(hue, i: N, t: N)` with optional a: N
 *
 * When hueRef contains an offset, presets are never used (presets only apply
 * to bare hue names in postcss-tug-color).
 */
function makeTugColor(
  hueRef: string,
  i: number,
  t: number,
  a = 100,
): string {
  const ri = Math.round(i);
  const rt = Math.round(t);
  const ra = Math.round(a);

  // Bare keyword shortcuts: black and white bypass the normal i/t/a parameters.
  // Opaque black/white emit the bare form; semi-transparent emit with a: N only.
  if (hueRef === "black") {
    if (ra === 100) return "--tug-color(black)";
    return `--tug-color(black, a: ${ra})`;
  }
  if (hueRef === "white") {
    if (ra === 100) return "--tug-color(white)";
    return `--tug-color(white, a: ${ra})`;
  }

  // Canonical bare form
  if (ri === 50 && rt === 50 && ra === 100) {
    return `--tug-color(${hueRef})`;
  }

  // Preset suffix (only for bare hue names without offset)
  const hasOffset = hueRef.includes("+") || /[a-z]-\d/.test(hueRef);
  if (!hasOffset) {
    if (ri === 20 && rt === 85 && ra === 100) return `--tug-color(${hueRef}-light)`;
    if (ri === 50 && rt === 20 && ra === 100) return `--tug-color(${hueRef}-dark)`;
    if (ri === 90 && rt === 50 && ra === 100) return `--tug-color(${hueRef}-intense)`;
    if (ri === 20 && rt === 50 && ra === 100) return `--tug-color(${hueRef}-muted)`;
  }

  // Full parameterized form — omit defaults: i=50, t=50, a=100
  const parts: string[] = [];
  if (ri !== 50) parts.push(`i: ${ri}`);
  if (rt !== 50) parts.push(`t: ${rt}`);
  if (ra !== 100) parts.push(`a: ${ra}`);

  if (parts.length === 0) {
    return `--tug-color(${hueRef})`;
  }
  return `--tug-color(${hueRef}, ${parts.join(", ")})`;
}

/** Achromatic black token string — bare keyword form per plan task [D01]. */
const BLACK_TOKEN = "--tug-color(black)";
/** Achromatic white token string — bare keyword form per plan task [D01]. */
const WHITE_TOKEN = "--tug-color(white)";

/** Resolved OKLCH for black (special-case per plan). */
const BLACK_RESOLVED: ResolvedColor = { L: 0, C: 0, h: 0, alpha: 1 };
/** Resolved OKLCH for white (special-case per plan). */
const WHITE_RESOLVED: ResolvedColor = { L: 1, C: 0, h: 0, alpha: 1 };

/**
 * Build a semi-transparent black token (shadow / overlay).
 * alpha is 0-100.
 */
function makeShadowToken(alpha: number): string {
  return `--tug-color(black, a: ${Math.round(alpha)})`;
}

/**
 * Build a semi-transparent white token (highlight / overlay).
 * alpha is 0-100.
 */
function makeHighlightToken(alpha: number): string {
  return `--tug-color(white, a: ${Math.round(alpha)})`;
}

/**
 * Build a resolved entry for a fully opaque chromatic token.
 */
function resolvedEntry(
  hueAngle: number,
  intensity: number,
  tone: number,
  hueName?: string,
): ResolvedColor {
  const { L, C, h } = resolveOklch(hueAngle, intensity, tone, hueName);
  return { L, C, h, alpha: 1 };
}

/**
 * Build a resolved entry for a semi-transparent chromatic token.
 */
function resolvedEntryAlpha(
  hueAngle: number,
  intensity: number,
  tone: number,
  alpha: number,
  hueName?: string,
): ResolvedColor {
  const { L, C, h } = resolveOklch(hueAngle, intensity, tone, hueName);
  return { L, C, h, alpha: alpha / 100 };
}

// ---------------------------------------------------------------------------
// deriveTheme — main entry point
// ---------------------------------------------------------------------------

/**
 * Derive a complete 264-token `--tug-base-*` theme from a `ThemeRecipe`.
 *
 * Returns `ThemeOutput` with:
 *   - `tokens`: every `--tug-base-*` token as a `--tug-color()` string or
 *     invariant value (for export / display)
 *   - `resolved`: OKLCH values for all chromatic tokens (for contrast checking
 *     and CVD simulation); structural and invariant tokens are absent [D09]
 *   - `contrastResults` / `cvdWarnings`: empty arrays (populated in Step 3/5)
 *
 * Role formulas are extracted from Brio (tug-base.css), Bluenote (bluenote.css),
 * and Harmony (harmony.css). Each formula maps (atmosphere, text, accent, primary,
 * semantic seeds + mood knobs + mode) to a specific token value.
 */
export function deriveTheme(recipe: ThemeRecipe): ThemeOutput {
  // -------------------------------------------------------------------------
  // 1. Resolve seed hue angles
  // -------------------------------------------------------------------------
  const atmHue = recipe.atmosphere.hue;
  const atmOffset = recipe.atmosphere.offset ?? 0;
  const atmAngle = resolveHueAngle(atmHue, atmOffset);

  const txtHue = recipe.text.hue;
  const txtOffset = recipe.text.offset ?? 0;
  const txtAngle = resolveHueAngle(txtHue, txtOffset);

  const accentHue = recipe.accent ?? "orange";
  const accentAngle = resolveHueAngle(accentHue);
  const accentName = closestHueName(accentAngle);

  const primaryHue = recipe.primary ?? "blue";
  const primaryAngle = resolveHueAngle(primaryHue);
  const primaryName = closestHueName(primaryAngle);
  const primaryRef = formatHueRef(primaryName, primaryAngle);

  const destructiveHue = recipe.destructive ?? "red";
  const successHue = recipe.success ?? "green";
  const cautionHue = recipe.caution ?? "yellow";
  const infoHue = recipe.info ?? "cyan";

  const isLight = recipe.mode === "light";

  // -------------------------------------------------------------------------
  // 2. Mood knob normalization (0-100, default 50)
  // -------------------------------------------------------------------------
  const surfaceContrast = recipe.surfaceContrast ?? 50;
  const signalVividity = recipe.signalVividity ?? 50;
  const warmth = recipe.warmth ?? 50;

  // Warmth hue bias: at warmth>50, shift neutral/achromatic hues toward warm
  // (amber/yellow range, positive angle bias); at warmth<50, shift toward cool.
  // Maximum bias ±12° applied to atmosphere and text hue angles when those hues
  // are in the achromatic-adjacent range (violet, cobalt, blue, purple, indigo).
  // Vivid accent/semantic hues (red, orange, yellow, green, cyan) are unaffected.
  const ACHROMATIC_ADJACENT_HUES = new Set([
    "violet", "cobalt", "blue", "indigo", "purple", "sky",
  ]);
  const warmthBias = ((warmth - 50) / 50) * 12; // ±12° at extremes

  function applyWarmthBias(hueName: string, angle: number): number {
    if (!ACHROMATIC_ADJACENT_HUES.has(hueName)) return angle;
    return (angle + warmthBias + 360) % 360;
  }

  // Atmosphere angle with warmth bias applied (for neutral/achromatic hues)
  const atmAngleW = applyWarmthBias(atmHue, atmAngle);
  const atmNameW = closestHueName(atmAngleW);
  const atmRefW = formatHueRef(atmNameW, atmAngleW);

  // Text angle with warmth bias applied
  const txtAngleW = applyWarmthBias(txtHue, txtAngle);
  const txtNameW = closestHueName(txtAngleW);
  const txtRefW = formatHueRef(txtNameW, txtAngleW);

  // Base hue angles (without recipe offset) — used for per-tier hue derivation.
  // Per-tier offsets are applied relative to the base hue, not the recipe offset.
  const atmBaseAngle = HUE_FAMILIES[atmHue] ?? atmAngle;
  const txtBaseAngle = HUE_FAMILIES[txtHue] ?? txtAngle;

  // -------------------------------------------------------------------------
  // 3. Derive surface/tone spread parameters from surfaceContrast and mode
  //
  // Dark mode: surface tones extracted from hand-authored themes:
  //   Brio (violet atm):  bg-app=5,  sunken=11, default=12, raised=11, overlay=14, inset=6,  content=6,  screen=16
  //   Bluenote (blue atm): bg-app=13, sunken=16, default=15, raised=17, overlay=19, inset=13, content=13, screen=29
  //
  // Calibrated formulas target the midpoint of Brio/Bluenote at surfaceContrast=50.
  //
  // Light mode: surface tones extracted from Harmony (yellow atm):
  //   bg-app=20, sunken=44, default=99, raised=24, overlay=48, inset=100, content=100, screen=80
  // -------------------------------------------------------------------------

  // Dark mode: calibrated formula targets Bluenote bg-app=13 at surfaceContrast=50.
  // Range: ~8 (low contrast) to ~18 (high contrast).
  const darkBgApp = isLight
    ? 20
    : 8 + (surfaceContrast / 100) * 10; // 50→13, matches Bluenote bg-app=13 ✓

  // bg-canvas in dark mode: below bg-app (more recessed background layer).
  // Bluenote uses t=6 (below bg-app t=13), Brio uses similar recessed tone.
  const darkBgCanvas = isLight ? 20 : Math.round(Math.max(1, darkBgApp - 7));

  // sunken: stepped above bg-app
  const darkSurfaceSunken = isLight
    ? Math.round(44)
    : Math.round(darkBgApp + 2 + (surfaceContrast / 100) * 3);

  // default: main content surface — calibrated for Bluenote t=15 at sc=50
  const darkSurfaceDefault = isLight
    ? Math.round(99)
    : Math.round(darkBgApp + 2 + (surfaceContrast / 100) * 2); // 50→15 ✓

  // raised: floats above default (cards, popovers)
  const darkSurfaceRaised = isLight
    ? Math.round(24)
    : Math.round(darkSurfaceDefault + 1 + (surfaceContrast / 100) * 2); // 50→17 ✓

  // overlay: dialogs, menus — slightly above default
  const darkSurfaceOverlay = isLight
    ? Math.round(48)
    : Math.round(darkSurfaceDefault + 3 + (surfaceContrast / 100) * 2); // 50→19 ✓

  // inset: recessed areas — below surface-default, near bg-app
  const darkSurfaceInset = isLight
    ? Math.round(100)
    : Math.round(darkBgApp); // matches Bluenote inset=13 ≈ bg-app ✓

  // content: matches inset (used for code blocks, inline content areas)
  const darkSurfaceContent = darkSurfaceInset;

  // screen: highest-elevated surface (tooltips, focused screens)
  // Calibrated: Bluenote=29, formula: bgApp + 11 + sc*10 → 13+11+5=29 ✓
  const darkSurfaceScreen = isLight
    ? Math.round(80)
    : Math.round(darkBgApp + 11 + (surfaceContrast / 100) * 10); // 50→29 ✓

  // -------------------------------------------------------------------------
  // 3a. Per-tier hue angle derivation for surface tokens (dark mode).
  //
  // Hand-authored themes use subtly different hue angles per surface tier to
  // create perceptual depth variation. Offsets are relative to atmBaseAngle:
  //   Bluenote (blue base=230, offset=9):
  //     bg-app/canvas: +9 (= recipe offset, the "main" atmosphere color)
  //     surface-default/raised/inset/content: +5
  //     surface-overlay: +6
  //     surface-sunken: +12 (≈ cobalt-8 in absolute terms)
  //     surface-screen: +10
  //
  // These per-tier offsets generalize to other hue families.
  // -------------------------------------------------------------------------
  function surfaceTierAngle(baseOffset: number): number {
    // Apply warmth bias to the per-tier angle if the atmosphere hue is achromatic-adjacent
    const raw = (atmBaseAngle + baseOffset + 360) % 360;
    return applyWarmthBias(atmHue, raw);
  }

  const surfDefaultAngle = surfaceTierAngle(5);
  const surfDefaultName = closestHueName(surfDefaultAngle);
  const surfDefaultRef = formatHueRef(surfDefaultName, surfDefaultAngle);

  const surfOverlayAngle = surfaceTierAngle(6);
  const surfOverlayName = closestHueName(surfOverlayAngle);
  const surfOverlayRef = formatHueRef(surfOverlayName, surfOverlayAngle);

  const surfSunkenAngle = surfaceTierAngle(12);
  const surfSunkenName = closestHueName(surfSunkenAngle);
  const surfSunkenRef = formatHueRef(surfSunkenName, surfSunkenAngle);

  const surfScreenAngle = surfaceTierAngle(10);
  const surfScreenName = closestHueName(surfScreenAngle);
  const surfScreenRef = formatHueRef(surfScreenName, surfScreenAngle);

  // -------------------------------------------------------------------------
  // 3b. Per-tier hue angle derivation for foreground tokens.
  //
  // Hand-authored themes use slightly shifted hue angles per fg tier:
  //   Dark mode (Bluenote, txtBase=blue=230):
  //     fg-default: no offset (bare txt hue)
  //     fg-muted: txtBase+6
  //     fg-subtle: txtBase+7
  //     fg-placeholder: txtBase+8
  //   Light mode (Harmony, txtBase=blue=230, txtOffset=5):
  //     fg-default: txtBase+5 (= recipe txt angle)
  //     fg-muted/subtle/disabled: txtBase (bare hue, strips the recipe offset)
  // -------------------------------------------------------------------------
  function fgTierAngle(darkOffset: number): number {
    if (isLight) {
      const raw = (txtBaseAngle + 360) % 360;
      return applyWarmthBias(txtHue, raw);
    }
    const raw = (txtBaseAngle + darkOffset + 360) % 360;
    return applyWarmthBias(txtHue, raw);
  }

  const fgDefaultAngleT = txtAngleW; // always uses full recipe txt angle
  const fgDefaultNameT = txtNameW;
  const fgDefaultRefT = txtRefW;

  const fgMutedAngle = fgTierAngle(6);
  const fgMutedName = closestHueName(fgMutedAngle);
  const fgMutedRef = formatHueRef(fgMutedName, fgMutedAngle);

  const fgSubtleAngle = fgTierAngle(7);
  const fgSubtleName = closestHueName(fgSubtleAngle);
  const fgSubtleRef = formatHueRef(fgSubtleName, fgSubtleAngle);

  const fgPlaceholderAngle = fgTierAngle(8);
  const fgPlaceholderName = closestHueName(fgPlaceholderAngle);
  const fgPlaceholderRef = formatHueRef(fgPlaceholderName, fgPlaceholderAngle);

  // Atmosphere intensity (low for surfaces — subdued, muted)
  const atmI = isLight ? 5 : 5;
  // Slightly higher intensity for some overlays
  const atmIBorder = isLight ? 9 : 6;

  // -------------------------------------------------------------------------
  // 4. Derive text tone anchors from mode
  // Dark mode: fg at tone ~94 (near-white), grading down toward muted/subtle/disabled
  // Light mode: fg at tone ~13 (near-black), grading up toward muted/subtle/disabled
  // -------------------------------------------------------------------------
  // Dark mode: Brio uses t=94 (cobalt), Bluenote uses t=88 (blue), so use ~90 as default
  // Light mode: Harmony uses t=13 (blue+5)
  const fgDefaultTone = isLight ? 13 : 90;
  // fg-muted dark: Bluenote uses bare `blue+6, i:8` which defaults to t=50 (canonical).
  // Using t=50 generalizes well across dark themes (canonical mid-tone for muted text).
  const fgMutedTone = isLight ? 22 : 50;
  const fgSubtleTone = isLight ? 30 : 37;
  const fgDisabledTone = isLight ? 44 : 23;
  const fgPlaceholderTone = isLight ? 28 : 30;

  // Text intensity: slightly higher for light mode (more contrast needed on bright bg)
  const txtI = isLight ? 8 : 3;
  const txtISubtle = isLight ? 9 : 7;
  // fg-muted uses higher intensity in dark mode to compensate for lower tone
  const fgMutedI = isLight ? txtISubtle : 8;

  // -------------------------------------------------------------------------
  // 5. Signal vividity modulation for accent / semantic hues
  // At signalVividity=50 → intensity=50 (canonical)
  // Range: 30 (muted) to 80 (vivid)
  // -------------------------------------------------------------------------
  const signalI = Math.round(30 + (signalVividity / 100) * 50);

  // -------------------------------------------------------------------------
  // 6. Derive all 264 tokens
  // -------------------------------------------------------------------------
  const tokens: Record<string, string> = {};
  const resolved: Record<string, ResolvedColor> = {};

  /** Set a chromatic token and compute its resolved value. */
  function setChromatic(
    name: string,
    hueRef: string,
    hueAngle: number,
    i: number,
    t: number,
    a = 100,
    hueName?: string,
  ): void {
    tokens[name] = makeTugColor(hueRef, i, t, a);
    if (a === 100) {
      resolved[name] = resolvedEntry(hueAngle, i, t, hueName);
    } else if (hueRef === "black" || (i === 0 && t === 0)) {
      resolved[name] = { ...BLACK_RESOLVED, alpha: a / 100 };
    } else if (hueRef === "white" || (i === 0 && t === 100)) {
      resolved[name] = { ...WHITE_RESOLVED, alpha: a / 100 };
    } else {
      resolved[name] = resolvedEntryAlpha(hueAngle, i, t, a, hueName);
    }
  }

  /** Set a shadow/overlay token (black-based). */
  function setShadow(name: string, alpha: number): void {
    tokens[name] = makeShadowToken(alpha);
    resolved[name] = { ...BLACK_RESOLVED, alpha: alpha / 100 };
  }

  /** Set a highlight token (white-based). */
  function setHighlight(name: string, alpha: number): void {
    tokens[name] = makeHighlightToken(alpha);
    resolved[name] = { ...WHITE_RESOLVED, alpha: alpha / 100 };
  }

  /** Set an achromatic white token (fully opaque). */
  function setWhite(name: string): void {
    tokens[name] = WHITE_TOKEN;
    resolved[name] = { ...WHITE_RESOLVED };
  }

  /** Set a structural (non-chromatic, non-invariant) token. */
  function setStructural(name: string, value: string): void {
    tokens[name] = value;
    // Structural tokens are absent from resolved map per [D09]
  }

  /** Set a theme-invariant token (pass-through from Brio). */
  function setInvariant(name: string, value: string): void {
    tokens[name] = value;
    // Invariant tokens are absent from resolved map per [D09]
  }

  // =========================================================================
  // A. Core Visual
  // =========================================================================

  // --- Surfaces ---
  // atmosphere hue drives all surfaces; tone levels from mode + surfaceContrast.
  // Dark mode uses per-tier hue angles (surfDefaultRef, surfOverlayRef, etc.) to
  // match hand-authored themes' subtle per-tier hue variation (e.g. Bluenote uses
  // blue+9 for bg-app but blue+5 for surface-default). Light mode uses atmRefW
  // (atmosphere hue with warmth bias) for atmosphere-colored surfaces.

  // bg-app:
  //   Dark mode: uses recipe atmosphere angle (atmRefW) — the "signature" atmosphere color.
  //   Light mode: Harmony uses TEXT hue (blue+5) for bg-app, not atmosphere (yellow).
  //   This creates the cooler recessed chrome look against warm canvas in light themes.
  if (isLight) {
    setChromatic("--tug-base-bg-app", txtRefW, txtAngleW, atmI, Math.round(darkBgApp), 100, txtNameW);
  } else {
    setChromatic("--tug-base-bg-app", atmRefW, atmAngleW, atmI, Math.round(darkBgApp), 100, atmNameW);
  }

  // bg-canvas: in light mode Harmony uses atmosphere hue (yellow t=39).
  // Dark mode: below bg-app (more recessed). Calibrated: Bluenote bg-canvas=t:6.
  const bgCanvasTone = isLight ? Math.round(35 + (surfaceContrast / 100) * 10) : Math.round(darkBgCanvas);
  setChromatic("--tug-base-bg-canvas", atmRefW, atmAngleW, isLight ? 7 : atmI, Math.round(bgCanvasTone), 100, atmNameW);

  // surface-sunken: dark mode uses per-tier angle (surfSunkenRef ≈ blue+12 = cobalt-8 for Bluenote)
  if (isLight) {
    setChromatic("--tug-base-surface-sunken", atmRefW, atmAngleW, atmI, Math.round(darkSurfaceSunken), 100, atmNameW);
  } else {
    setChromatic("--tug-base-surface-sunken", surfSunkenRef, surfSunkenAngle, isLight ? 6 : atmI + 3, Math.round(darkSurfaceSunken), 100, surfSunkenName);
  }

  // surface-default: dark mode uses per-tier angle (surfDefaultRef ≈ blue+5 for Bluenote)
  if (isLight) {
    setChromatic("--tug-base-surface-default", atmRefW, atmAngleW, isLight ? 4 : atmI, Math.round(darkSurfaceDefault), 100, atmNameW);
  } else {
    setChromatic("--tug-base-surface-default", surfDefaultRef, surfDefaultAngle, atmI, Math.round(darkSurfaceDefault), 100, surfDefaultName);
  }

  // surface-raised:
  //   Light mode: Harmony uses text hue (blue t=24) for contrast with warm canvas.
  //   Dark mode: per-tier angle (surfDefaultRef ≈ blue+5 for Bluenote).
  if (isLight) {
    setChromatic("--tug-base-surface-raised", txtRefW, txtAngleW, 5, Math.round(darkSurfaceRaised), 100, txtNameW);
  } else {
    setChromatic("--tug-base-surface-raised", surfDefaultRef, surfDefaultAngle, atmI, Math.round(darkSurfaceRaised), 100, surfDefaultName);
  }

  // surface-overlay: dark mode per-tier angle (surfOverlayRef ≈ blue+6 for Bluenote)
  if (isLight) {
    setChromatic("--tug-base-surface-overlay", atmRefW, atmAngleW, isLight ? 6 : atmI, Math.round(darkSurfaceOverlay), 100, atmNameW);
  } else {
    setChromatic("--tug-base-surface-overlay", surfOverlayRef, surfOverlayAngle, isLight ? 7 : atmI + 2, Math.round(darkSurfaceOverlay), 100, surfOverlayName);
  }

  // surface-inset: dark mode per-tier angle (surfDefaultRef ≈ blue+5 for Bluenote)
  if (isLight) {
    setChromatic("--tug-base-surface-inset", atmRefW, atmAngleW, isLight ? 4 : atmI, Math.round(darkSurfaceInset), 100, atmNameW);
  } else {
    setChromatic("--tug-base-surface-inset", surfDefaultRef, surfDefaultAngle, atmI, Math.round(darkSurfaceInset), 100, surfDefaultName);
  }

  // surface-content: same as surface-inset (code blocks, inline content areas)
  if (isLight) {
    setChromatic("--tug-base-surface-content", atmRefW, atmAngleW, isLight ? 4 : atmI, Math.round(darkSurfaceContent), 100, atmNameW);
  } else {
    setChromatic("--tug-base-surface-content", surfDefaultRef, surfDefaultAngle, atmI, Math.round(darkSurfaceContent), 100, surfDefaultName);
  }

  // surface-screen:
  //   Light mode: Harmony uses text hue (blue t=80).
  //   Dark mode: per-tier angle (surfScreenRef ≈ blue+10 for Bluenote).
  if (isLight) {
    setChromatic("--tug-base-surface-screen", txtRefW, txtAngleW, 4, Math.round(darkSurfaceScreen), 100, txtNameW);
  } else {
    setChromatic("--tug-base-surface-screen", surfScreenRef, surfScreenAngle, isLight ? 4 : atmI + 3, Math.round(darkSurfaceScreen), 100, surfScreenName);
  }

  // --- Foreground / Text ---
  // text hue drives all foreground tokens; tone from mode.
  // Per-tier hue angles are used for muted/subtle/placeholder tokens — they sample
  // slightly different positions along the hue spectrum (e.g. Bluenote fg-muted=blue+6,
  // fg-subtle=blue+7, fg-placeholder=blue+8). Light mode collapses these to the base hue.

  setChromatic("--tug-base-fg-default", fgDefaultRefT, fgDefaultAngleT, txtI, fgDefaultTone, 100, fgDefaultNameT);
  setChromatic("--tug-base-fg-muted", fgMutedRef, fgMutedAngle, fgMutedI, fgMutedTone, 100, fgMutedName);
  setChromatic("--tug-base-fg-subtle", fgSubtleRef, fgSubtleAngle, txtISubtle, fgSubtleTone, 100, fgSubtleName);
  setChromatic("--tug-base-fg-disabled", txtRefW, txtAngleW, txtISubtle, fgDisabledTone, 100, txtNameW);

  // fg-inverse: opposite extreme (near-white in dark, near-black in light).
  // Light mode: use near-zero intensity to minimize chroma — matches Harmony's use of
  // sky, i:1, t:100 (essentially white with a slight sky tint). Using i=1 keeps the
  // resolved color close to white regardless of text hue, matching the low-chroma intent.
  const fgInverseTone = 100;
  const fgInverseI = isLight ? 1 : Math.max(1, txtI - 1);
  setChromatic("--tug-base-fg-inverse", txtRefW, txtAngleW, fgInverseI, fgInverseTone, 100, txtNameW);

  // fg-placeholder: in dark mode uses per-tier text hue; in light mode uses atmosphere hue
  // (Harmony: yellow i:9 t:28 for placeholder, matching the warm border tones)
  if (isLight) {
    setChromatic("--tug-base-fg-placeholder", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
  } else {
    setChromatic("--tug-base-fg-placeholder", fgPlaceholderRef, fgPlaceholderAngle, txtISubtle, fgPlaceholderTone, 100, fgPlaceholderName);
  }

  // fg-link: info hue (cyan by default), canonical
  setChromatic("--tug-base-fg-link", infoHue, resolveHueAngle(infoHue), signalI, 50);
  setChromatic("--tug-base-fg-link-hover", infoHue, resolveHueAngle(infoHue), Math.min(90, signalI + 20), 55);

  // fg-onAccent: text over accent background (need high contrast)
  // In dark mode: near-white over accent; in light mode: near-white over accent (accent is dark enough)
  if (isLight) {
    setWhite("--tug-base-fg-onAccent");
    setWhite("--tug-base-fg-onDanger");
  } else {
    setChromatic("--tug-base-fg-onAccent", txtRefW, txtAngleW, Math.max(1, txtI - 1), fgInverseTone, 100, txtNameW);
    setChromatic("--tug-base-fg-onDanger", txtRefW, txtAngleW, Math.max(1, txtI - 1), fgInverseTone, 100, txtNameW);
  }

  // fg-onCaution: dark text on yellow/caution (yellow is bright, needs dark text in both modes)
  setChromatic("--tug-base-fg-onCaution", atmRefW, atmAngleW, atmI, Math.round(isLight ? 7 : 7), 100, atmNameW);
  setChromatic("--tug-base-fg-onSuccess", atmRefW, atmAngleW, atmI, Math.round(isLight ? 7 : 7), 100, atmNameW);

  // --- Icon ---
  // Icons follow text hue, same tones as fg-muted/subtle/disabled.
  // Per-tier hue angles match hand-authored themes (e.g. Bluenote icon-default=blue+6, icon-muted=blue+7).
  setChromatic("--tug-base-icon-default", fgMutedRef, fgMutedAngle, fgMutedI, fgMutedTone, 100, fgMutedName);
  // icon-muted: in light mode uses atmosphere hue (Harmony: yellow i:9 t:28)
  if (isLight) {
    setChromatic("--tug-base-icon-muted", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
  } else {
    // Dark mode: Bluenote icon-muted = blue+7, i:9, t:34. Use fgMutedI intensity at fgSubtleTone-3.
    setChromatic("--tug-base-icon-muted", fgSubtleRef, fgSubtleAngle, fgMutedI, Math.round(fgSubtleTone - 3), 100, fgSubtleName);
  }
  setChromatic("--tug-base-icon-disabled", txtRefW, txtAngleW, txtISubtle, fgDisabledTone, 100, txtNameW);

  // icon-active: vivid primary text color (active/selected state)
  setChromatic("--tug-base-icon-active", txtRefW, txtAngleW, 100, isLight ? 22 : 80, 100, txtNameW);

  // icon-onAccent: follows fg-onAccent
  if (isLight) {
    setWhite("--tug-base-icon-onAccent");
  } else {
    setChromatic("--tug-base-icon-onAccent", txtRefW, txtAngleW, Math.max(1, txtI - 1), fgInverseTone, 100, txtNameW);
  }

  // --- Borders / Dividers / Focus ---
  // In dark mode: borders use text hue (Brio/Bluenote pattern — cobalt/blue text).
  // In light mode: borders use atmosphere hue (Harmony pattern — yellow atmosphere).
  // This reflects the principle that on warm light backgrounds, structural elements
  // should harmonize with the warm atmosphere rather than the cool text hue.

  // Borders: dark mode uses per-tier fg angles for richer hue variation
  // (Bluenote: border-default=blue+8, border-muted=blue+7, border-strong=blue)
  // Light mode: atmosphere hue for borders (Harmony: yellow).
  // border-muted in light mode: Harmony uses i:10 at a higher tone than border-default.
  // border-strong in light mode: Harmony uses yellow-5 (atm base minus 5°) at lower tone.
  const borderHueRef = isLight ? atmRefW : fgPlaceholderRef;
  const borderHueAngle = isLight ? atmAngleW : fgPlaceholderAngle;
  const borderHueName = isLight ? atmNameW : fgPlaceholderName;
  const borderIBase = isLight ? atmIBorder : txtISubtle;
  const borderIStrong = isLight ? 9 : txtISubtle;

  // border-muted: dark uses fg-subtle tier (blue+7), light uses higher tone/intensity
  const borderMutedHueRef = isLight ? atmRefW : fgSubtleRef;
  const borderMutedHueAngle = isLight ? atmAngleW : fgSubtleAngle;
  const borderMutedHueName = isLight ? atmNameW : fgSubtleName;
  const borderMutedTone = isLight ? 36 : fgSubtleTone;
  const borderMutedI = isLight ? 10 : borderIBase;

  // border-strong: dark uses bare text hue; light uses atm base minus 5° (Harmony: yellow-5)
  const borderStrongLightAngle = applyWarmthBias(atmHue, (atmBaseAngle - 5 + 360) % 360);
  const borderStrongLightName = closestHueName(borderStrongLightAngle);
  const borderStrongLightRef = formatHueRef(borderStrongLightName, borderStrongLightAngle);
  const borderStrongHueRef = isLight ? borderStrongLightRef : txtRefW;
  const borderStrongHueAngle = isLight ? borderStrongLightAngle : txtAngleW;
  const borderStrongHueName = isLight ? borderStrongLightName : txtNameW;
  // Dark mode: Bluenote border-strong = blue, i:8, t:43 (fgSubtleTone+6). Use fgMutedI=8 intensity.
  const borderStrongTone = isLight ? Math.round(fgSubtleTone - 6) : Math.round(fgSubtleTone + 6);
  const borderStrongI = isLight ? borderIStrong : fgMutedI;

  setChromatic("--tug-base-border-default", borderHueRef, borderHueAngle, borderIBase, fgPlaceholderTone, 100, borderHueName);
  setChromatic("--tug-base-border-muted", borderMutedHueRef, borderMutedHueAngle, borderMutedI, borderMutedTone, 100, borderMutedHueName);
  setChromatic("--tug-base-border-strong", borderStrongHueRef, borderStrongHueAngle, borderStrongI, borderStrongTone, 100, borderStrongHueName);
  setChromatic("--tug-base-border-inverse", fgDefaultRefT, fgDefaultAngleT, txtI, fgDefaultTone, 100, fgDefaultNameT);
  setChromatic("--tug-base-border-accent", accentHue, accentAngle, signalI, 50, 100, accentName);
  setChromatic("--tug-base-border-danger", destructiveHue, resolveHueAngle(destructiveHue), signalI, 50);

  // dividers: atmosphere hue, very low intensity
  // Light mode: Harmony uses yellow at t=46/48; dark mode: just below surface-raised
  const dividerTone = isLight ? Math.round(darkSurfaceOverlay - 2) : Math.round(darkSurfaceRaised - 2);
  setChromatic("--tug-base-divider-default", atmRefW, atmAngleW, atmI, Math.round(dividerTone), 100, atmNameW);
  setChromatic("--tug-base-divider-muted", atmRefW, atmAngleW, atmI, Math.round(dividerTone + 2), 100, atmNameW);

  // focus ring: info hue (cyan), danger, offset = deep surface
  setChromatic("--tug-base-focus-ring-default", infoHue, resolveHueAngle(infoHue), signalI, 50);
  setChromatic("--tug-base-focus-ring-danger", destructiveHue, resolveHueAngle(destructiveHue), signalI, 50);
  setChromatic("--tug-base-focus-ring-offset", atmRefW, atmAngleW, atmI, Math.round(isLight ? 99 : darkBgApp), 100, atmNameW);

  // --- Elevation / Overlay ---
  // Shadows are always black-based with alpha; overlays black or white
  // In dark mode: higher alpha shadows. In light mode: lower alpha.
  const shadowXsAlpha = isLight ? 8 : 20;
  const shadowMdAlpha = isLight ? 30 : 60;
  const shadowLgAlpha = isLight ? 36 : 70;
  const shadowXlAlpha = isLight ? 44 : 80;
  const shadowOverlayAlpha = isLight ? 24 : 60;
  const overlayDimAlpha = isLight ? 20 : 48;
  const overlayScrimAlpha = isLight ? 32 : 64;
  const overlayHighlightAlpha = isLight ? 50 : 6;

  setShadow("--tug-base-shadow-xs", shadowXsAlpha);
  setShadow("--tug-base-shadow-md", shadowMdAlpha);
  setShadow("--tug-base-shadow-lg", shadowLgAlpha);
  setShadow("--tug-base-shadow-xl", shadowXlAlpha);

  // shadow-overlay: composite value — structural prefix + embedded --tug-color()
  setStructural(
    "--tug-base-shadow-overlay",
    `0 4px 16px ${makeShadowToken(shadowOverlayAlpha)}`,
  );
  resolved["--tug-base-shadow-overlay"] = {
    ...BLACK_RESOLVED,
    alpha: shadowOverlayAlpha / 100,
  };

  setShadow("--tug-base-overlay-dim", overlayDimAlpha);
  setShadow("--tug-base-overlay-scrim", overlayScrimAlpha);
  setHighlight("--tug-base-overlay-highlight", overlayHighlightAlpha);

  // --- Typography (invariant) ---
  setInvariant("--tug-base-font-family-sans", '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif');
  setInvariant("--tug-base-font-family-mono", '"Hack", "JetBrains Mono", "SFMono-Regular", "Menlo", monospace');
  setInvariant("--tug-base-font-size-2xs", "11px");
  setInvariant("--tug-base-font-size-xs", "12px");
  setInvariant("--tug-base-font-size-sm", "13px");
  setInvariant("--tug-base-font-size-md", "14px");
  setInvariant("--tug-base-font-size-lg", "16px");
  setInvariant("--tug-base-font-size-xl", "20px");
  setInvariant("--tug-base-font-size-2xl", "24px");
  setInvariant("--tug-base-line-height-2xs", "15px");
  setInvariant("--tug-base-line-height-xs", "17px");
  setInvariant("--tug-base-line-height-sm", "19px");
  setInvariant("--tug-base-line-height-md", "20px");
  setInvariant("--tug-base-line-height-lg", "24px");
  setInvariant("--tug-base-line-height-xl", "28px");
  setInvariant("--tug-base-line-height-2xl", "32px");
  setInvariant("--tug-base-line-height-tight", "1.2");
  setInvariant("--tug-base-line-height-normal", "1.45");

  // --- Spacing (invariant) ---
  setInvariant("--tug-base-space-2xs", "2px");
  setInvariant("--tug-base-space-xs", "4px");
  setInvariant("--tug-base-space-sm", "6px");
  setInvariant("--tug-base-space-md", "8px");
  setInvariant("--tug-base-space-lg", "12px");
  setInvariant("--tug-base-space-xl", "16px");
  setInvariant("--tug-base-space-2xl", "24px");

  // --- Radius (invariant) ---
  setInvariant("--tug-base-radius-2xs", "1px");
  setInvariant("--tug-base-radius-xs", "2px");
  setInvariant("--tug-base-radius-sm", "4px");
  setInvariant("--tug-base-radius-md", "6px");
  setInvariant("--tug-base-radius-lg", "8px");
  setInvariant("--tug-base-radius-xl", "12px");
  setInvariant("--tug-base-radius-2xl", "16px");

  // --- Stroke (invariant) ---
  setInvariant("--tug-base-stroke-hairline", "0.5px");
  setInvariant("--tug-base-stroke-thin", "1px");
  setInvariant("--tug-base-stroke-medium", "1.5px");
  setInvariant("--tug-base-stroke-thick", "2px");

  // --- Chrome (invariant) ---
  setInvariant("--tug-base-chrome-height", "36px");

  // --- Icon Size (invariant) ---
  setInvariant("--tug-base-icon-size-2xs", "10px");
  setInvariant("--tug-base-icon-size-xs", "12px");
  setInvariant("--tug-base-icon-size-sm", "13px");
  setInvariant("--tug-base-icon-size-md", "15px");
  setInvariant("--tug-base-icon-size-lg", "20px");
  setInvariant("--tug-base-icon-size-xl", "24px");

  // --- Motion (invariant; duration tokens are calc-based in tug-base.css body{}) ---
  // Note: fast/moderate/slow/glacial are defined in the tug-base.css body{} block
  // (not :root) so they're part of the 264 token set.
  setInvariant("--tug-base-motion-duration-fast", "calc(100ms * var(--tug-timing))");
  setInvariant("--tug-base-motion-duration-moderate", "calc(200ms * var(--tug-timing))");
  setInvariant("--tug-base-motion-duration-slow", "calc(350ms * var(--tug-timing))");
  setInvariant("--tug-base-motion-duration-glacial", "calc(500ms * var(--tug-timing))");
  setInvariant("--tug-base-motion-duration-instant", "calc(0ms * var(--tug-timing))");
  setInvariant("--tug-base-motion-easing-standard", "cubic-bezier(0.2, 0, 0, 1)");
  setInvariant("--tug-base-motion-easing-enter", "cubic-bezier(0, 0, 0, 1)");
  setInvariant("--tug-base-motion-easing-exit", "cubic-bezier(0.2, 0, 1, 1)");
  setInvariant("--tug-base-motion-pattern-fade-enter", "opacity var(--tug-base-motion-duration-moderate) var(--tug-base-motion-easing-enter)");
  setInvariant("--tug-base-motion-pattern-fade-exit", "opacity var(--tug-base-motion-duration-fast) var(--tug-base-motion-easing-exit)");
  setInvariant("--tug-base-motion-pattern-overlay-enter", "opacity var(--tug-base-motion-duration-moderate) var(--tug-base-motion-easing-enter), transform var(--tug-base-motion-duration-moderate) var(--tug-base-motion-easing-enter)");
  setInvariant("--tug-base-motion-pattern-overlay-exit", "opacity var(--tug-base-motion-duration-fast) var(--tug-base-motion-easing-exit), transform var(--tug-base-motion-duration-fast) var(--tug-base-motion-easing-exit)");
  setInvariant("--tug-base-motion-pattern-collapse", "height var(--tug-base-motion-duration-moderate) var(--tug-base-motion-easing-standard)");
  setInvariant("--tug-base-motion-pattern-expand", "height var(--tug-base-motion-duration-moderate) var(--tug-base-motion-easing-standard)");
  setInvariant("--tug-base-motion-pattern-crossfade", "opacity var(--tug-base-motion-duration-fast) var(--tug-base-motion-easing-standard)");
  setInvariant("--tug-base-motion-pattern-startup-reveal", "opacity var(--tug-base-motion-duration-slow) var(--tug-base-motion-easing-enter)");

  // =========================================================================
  // B. Accent System
  // =========================================================================

  setChromatic("--tug-base-accent-default", accentHue, accentAngle, signalI, 50, 100, accentName);
  setChromatic("--tug-base-accent-strong", accentHue, accentAngle, Math.min(90, signalI + 20), 50, 100, accentName);
  // accent-muted: in light mode needs a darker tone to maintain contrast on light backgrounds [D06]
  // Dark mode: lighter/muted version (standard). Light mode: darker version (contrast-critical).
  const accentMutedTone = isLight ? 38 : 50;
  const accentMutedI = isLight ? Math.max(10, signalI - 5) : Math.max(10, signalI - 20);
  setChromatic("--tug-base-accent-muted", accentHue, accentAngle, accentMutedI, accentMutedTone, 100, accentName);
  setChromatic("--tug-base-accent-subtle", accentHue, accentAngle, signalI, 50, 15, accentName);

  // accent-cool: primary hue at intense level
  setChromatic("--tug-base-accent-cool-default", primaryHue, primaryAngle, Math.min(90, signalI + 20), 50, 100, primaryName);

  // Accent-derived interaction tokens
  setChromatic("--tug-base-accent-bg-subtle", accentHue, accentAngle, signalI, 50, 12, accentName);
  setChromatic("--tug-base-accent-bg-emphasis", accentHue, accentAngle, signalI, 50, 24, accentName);
  setChromatic("--tug-base-accent-border", accentHue, accentAngle, signalI, 50, 100, accentName);
  setChromatic("--tug-base-accent-border-hover", accentHue, accentAngle, Math.min(90, signalI + 20), 50, 100, accentName);
  setChromatic("--tug-base-accent-underline-active", accentHue, accentAngle, signalI, 50, 100, accentName);
  setChromatic("--tug-base-accent-guide", accentHue, accentAngle, signalI, 50, 50, accentName);
  setChromatic("--tug-base-accent-flash", accentHue, accentAngle, signalI, 50, 40, accentName);

  // =========================================================================
  // C. Semantic Tones
  // =========================================================================

  const successAngle = resolveHueAngle(successHue);
  const successName = closestHueName(successAngle);
  const cautionAngle = resolveHueAngle(cautionHue);
  const cautionName = closestHueName(cautionAngle);
  const dangerAngle = resolveHueAngle(destructiveHue);
  const dangerName = closestHueName(dangerAngle);
  const infoAngle = resolveHueAngle(infoHue);
  const infoName = closestHueName(infoAngle);

  setChromatic("--tug-base-tone-success", successHue, successAngle, signalI, 50, 100, successName);
  setChromatic("--tug-base-tone-success-bg", successHue, successAngle, signalI, 50, 15, successName);
  setChromatic("--tug-base-tone-success-fg", successHue, successAngle, signalI, 50, 100, successName);
  setChromatic("--tug-base-tone-success-border", successHue, successAngle, signalI, 50, 100, successName);
  setChromatic("--tug-base-tone-success-icon", successHue, successAngle, signalI, 50, 100, successName);

  setChromatic("--tug-base-tone-caution", cautionHue, cautionAngle, signalI, 50, 100, cautionName);
  setChromatic("--tug-base-tone-caution-bg", cautionHue, cautionAngle, signalI, 50, 12, cautionName);
  setChromatic("--tug-base-tone-caution-fg", cautionHue, cautionAngle, signalI, 50, 100, cautionName);
  setChromatic("--tug-base-tone-caution-border", cautionHue, cautionAngle, signalI, 50, 100, cautionName);
  setChromatic("--tug-base-tone-caution-icon", cautionHue, cautionAngle, signalI, 50, 100, cautionName);

  setChromatic("--tug-base-tone-danger", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-tone-danger-bg", destructiveHue, dangerAngle, signalI, 50, 15, dangerName);
  setChromatic("--tug-base-tone-danger-fg", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-tone-danger-border", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-tone-danger-icon", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);

  setChromatic("--tug-base-tone-info", infoHue, infoAngle, signalI, 50, 100, infoName);
  setChromatic("--tug-base-tone-info-bg", infoHue, infoAngle, signalI, 50, 12, infoName);
  setChromatic("--tug-base-tone-info-fg", infoHue, infoAngle, signalI, 50, 100, infoName);
  setChromatic("--tug-base-tone-info-border", infoHue, infoAngle, signalI, 50, 100, infoName);
  setChromatic("--tug-base-tone-info-icon", infoHue, infoAngle, signalI, 50, 100, infoName);

  // =========================================================================
  // D. Selection / Highlight / Preview
  // =========================================================================

  // selection-bg: primary/info hue with moderate alpha
  setChromatic("--tug-base-selection-bg", infoHue, infoAngle, signalI, 50, 40, infoName);
  // selection-bg-inactive: muted tint of text hue (Brio: yellow/i:0/t:30/a:25, Bluenote: blue/i:10/t:33/a:30)
  // In dark mode, use text hue at low intensity. In light mode, use atmosphere warm tint.
  // selection-bg-inactive:
  //   Dark mode: text hue at low intensity, slightly higher tone than placeholder.
  //     Bluenote: blue, i:10, t:33, a:30.
  //   Light mode: atmosphere hue shifted toward amber (-20° from atm base) for warmth.
  //     Harmony: amber (yellow-20°), i:8, t:24, a:20.
  if (isLight) {
    // Use a warmer-shifted atmosphere hue (amber) for selection in light mode
    const selInactAngle = applyWarmthBias(atmHue, (atmBaseAngle - 20 + 360) % 360);
    const selInactName = closestHueName(selInactAngle);
    const selInactRef = formatHueRef(selInactName, selInactAngle);
    setChromatic("--tug-base-selection-bg-inactive", selInactRef, selInactAngle, 8, 24, 20, selInactName);
  } else {
    setChromatic("--tug-base-selection-bg-inactive", txtRefW, txtAngleW, 10, 33, 30, txtNameW);
  }
  setChromatic("--tug-base-selection-fg", fgDefaultRefT, fgDefaultAngleT, txtI, fgDefaultTone, 100, fgDefaultNameT);

  // highlights: white or black semi-transparent overlays depending on mode
  if (isLight) {
    setShadow("--tug-base-highlight-hover", 4);
    setChromatic("--tug-base-highlight-dropTarget", infoHue, infoAngle, signalI, 50, 18, infoName);
    setChromatic("--tug-base-highlight-preview", infoHue, infoAngle, signalI, 50, 12, infoName);
    setChromatic("--tug-base-highlight-inspectorTarget", infoHue, infoAngle, signalI, 50, 22, infoName);
    setChromatic("--tug-base-highlight-snapGuide", infoHue, infoAngle, signalI, 50, 50, infoName);
  } else {
    setHighlight("--tug-base-highlight-hover", 5);
    setChromatic("--tug-base-highlight-dropTarget", infoHue, infoAngle, signalI, 50, 18, infoName);
    setChromatic("--tug-base-highlight-preview", infoHue, infoAngle, signalI, 50, 12, infoName);
    setChromatic("--tug-base-highlight-inspectorTarget", infoHue, infoAngle, signalI, 50, 22, infoName);
    setChromatic("--tug-base-highlight-snapGuide", infoHue, infoAngle, signalI, 50, 50, infoName);
  }
  setChromatic("--tug-base-highlight-flash", accentHue, accentAngle, signalI, 50, 35, accentName);

  // =========================================================================
  // E. Control Surfaces
  // =========================================================================

  // --- Cross-Control Disabled Contract ---
  // disabled-bg: in light mode Harmony uses very light yellow (t=74); dark mode uses sunken surface tone
  const disabledBgTone = isLight ? Math.round(70 + (surfaceContrast / 100) * 10) : Math.round(darkSurfaceSunken);
  setChromatic("--tug-base-control-disabled-bg", atmRefW, atmAngleW, isLight ? 6 : atmI, disabledBgTone);
  setChromatic("--tug-base-control-disabled-fg", txtRefW, txtAngleW, txtISubtle, fgDisabledTone);
  setChromatic("--tug-base-control-disabled-border", atmRefW, atmAngleW, atmIBorder, Math.round(dividerTone));
  setChromatic("--tug-base-control-disabled-icon", txtRefW, txtAngleW, txtISubtle, fgDisabledTone);
  setInvariant("--tug-base-control-disabled-opacity", "0.5");
  setStructural("--tug-base-control-disabled-shadow", "none");

  // --- Primary ---
  // Primary: based on primary hue, dark/hover/active gradient
  const primaryDarkTone = isLight ? 30 : 20;
  const primaryHoverTone = isLight ? 40 : 40;
  const primaryActiveTone = isLight ? 50 : 50;
  const primaryFgTone = isLight ? 100 : 100;

  setChromatic("--tug-base-control-primary-bg-rest", primaryRef, primaryAngle, 50, primaryDarkTone, 100, primaryName);
  setChromatic("--tug-base-control-primary-bg-hover", primaryRef, primaryAngle, 55, primaryHoverTone, 100, primaryName);
  setChromatic("--tug-base-control-primary-bg-active", primaryRef, primaryAngle, 90, primaryActiveTone, 100, primaryName);
  setStructural("--tug-base-control-primary-bg-disabled", "var(--tug-base-control-disabled-bg)");
  // Primary fg: near-white text on primary dark bg
  setChromatic("--tug-base-control-primary-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);
  setChromatic("--tug-base-control-primary-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);
  setChromatic("--tug-base-control-primary-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);
  // Primary border: primary hue, slight variation
  setChromatic("--tug-base-control-primary-border-rest", primaryRef, primaryAngle, signalI, 50, 100, primaryName);
  setChromatic("--tug-base-control-primary-border-hover", primaryRef, primaryAngle, Math.min(90, signalI + 10), 50, 100, primaryName);
  setChromatic("--tug-base-control-primary-border-active", primaryRef, primaryAngle, 90, primaryActiveTone, 100, primaryName);
  // Primary icon: same as fg
  setChromatic("--tug-base-control-primary-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);
  setChromatic("--tug-base-control-primary-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);
  setChromatic("--tug-base-control-primary-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);

  // --- Secondary ---
  // Secondary: atmosphere hue, subtle variation.
  // Dark mode: per-tier hue angles matching Bluenote's pattern:
  //   rest: atmRefW (blue+9), i=atmI=5, t=darkSurfaceInset+2
  //   hover: surfDefaultRef (blue+5), i=atmI=5, t=darkSurfaceRaised+1
  //   active: surfOverlayRef (blue+6), i=atmI+2=7, t=darkSurfaceOverlay
  const secBgRestTone = isLight ? 51 : Math.round(darkSurfaceInset + 2);
  const secBgHoverTone = isLight ? 99 : Math.round(darkSurfaceRaised + 1);
  const secBgActiveTone = isLight ? 48 : Math.round(darkSurfaceOverlay);

  if (isLight) {
    setChromatic("--tug-base-control-secondary-bg-rest", atmRefW, atmAngleW, 7, secBgRestTone, 100, atmNameW);
    setChromatic("--tug-base-control-secondary-bg-hover", atmRefW, atmAngleW, 4, secBgHoverTone, 100, atmNameW);
    setChromatic("--tug-base-control-secondary-bg-active", atmRefW, atmAngleW, 6, secBgActiveTone, 100, atmNameW);
  } else {
    // Dark mode: use per-tier hue angles + atmI to match Bluenote overrides
    setChromatic("--tug-base-control-secondary-bg-rest", atmRefW, atmAngleW, atmI, secBgRestTone, 100, atmNameW);
    setChromatic("--tug-base-control-secondary-bg-hover", surfDefaultRef, surfDefaultAngle, atmI, secBgHoverTone, 100, surfDefaultName);
    setChromatic("--tug-base-control-secondary-bg-active", surfOverlayRef, surfOverlayAngle, atmI + 2, secBgActiveTone, 100, surfOverlayName);
  }
  setStructural("--tug-base-control-secondary-bg-disabled", "var(--tug-base-control-disabled-bg)");
  // Secondary fg: default text
  setChromatic("--tug-base-control-secondary-fg-rest", txtRefW, txtAngleW, txtI, fgDefaultTone);
  setChromatic("--tug-base-control-secondary-fg-hover", txtRefW, txtAngleW, txtI, isLight ? 10 : 100);
  setChromatic("--tug-base-control-secondary-fg-active", txtRefW, txtAngleW, txtI, isLight ? 8 : 100);
  // Secondary border: in light mode uses atmosphere hue (Harmony: yellow); dark uses text hue.
  // Light mode tone offsets: +7/+12 (Harmony: t:35, t:40) instead of +5/+10.
  if (isLight) {
    setChromatic("--tug-base-control-secondary-border-rest", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
    setChromatic("--tug-base-control-secondary-border-hover", atmRefW, atmAngleW, 12, Math.round(fgPlaceholderTone + 7), 100, atmNameW);
    setChromatic("--tug-base-control-secondary-border-active", atmRefW, atmAngleW, 15, Math.round(fgPlaceholderTone + 12), 100, atmNameW);
  } else {
    setChromatic("--tug-base-control-secondary-border-rest", txtRefW, txtAngleW, 10, fgPlaceholderTone);
    setChromatic("--tug-base-control-secondary-border-hover", txtRefW, txtAngleW, 15, Math.round(fgPlaceholderTone + 5));
    setChromatic("--tug-base-control-secondary-border-active", txtRefW, txtAngleW, 20, Math.round(fgPlaceholderTone + 10));
  }
  // Secondary icon: text hue at muted/default
  setChromatic("--tug-base-control-secondary-icon-rest", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
  setChromatic("--tug-base-control-secondary-icon-hover", txtRefW, txtAngleW, txtISubtle, isLight ? 22 : 80);
  setChromatic("--tug-base-control-secondary-icon-active", txtRefW, txtAngleW, txtISubtle, isLight ? 13 : 94);

  // --- Ghost ---
  setStructural("--tug-base-control-ghost-bg-rest", "transparent");
  if (isLight) {
    setShadow("--tug-base-control-ghost-bg-hover", 6);
    setShadow("--tug-base-control-ghost-bg-active", 12);
  } else {
    setHighlight("--tug-base-control-ghost-bg-hover", 10);
    setHighlight("--tug-base-control-ghost-bg-active", 20);
  }
  setChromatic("--tug-base-control-ghost-fg-rest", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
  setChromatic("--tug-base-control-ghost-fg-hover", txtRefW, txtAngleW, isLight ? 9 : 15, isLight ? 15 : 80);
  setChromatic("--tug-base-control-ghost-fg-active", txtRefW, txtAngleW, isLight ? 9 : 35, isLight ? 10 : 94);
  setStructural("--tug-base-control-ghost-border-rest", "transparent");
  setChromatic("--tug-base-control-ghost-border-hover", txtRefW, txtAngleW, isLight ? 10 : 20, isLight ? 35 : 60);
  setChromatic("--tug-base-control-ghost-border-active", txtRefW, txtAngleW, isLight ? 10 : 20, isLight ? 35 : 60);
  setChromatic("--tug-base-control-ghost-icon-rest", txtRefW, txtAngleW, txtISubtle, fgSubtleTone);
  setChromatic("--tug-base-control-ghost-icon-hover", txtRefW, txtAngleW, txtISubtle, isLight ? 22 : 65);
  setChromatic("--tug-base-control-ghost-icon-active", txtRefW, txtAngleW, isLight ? 27 : 27, isLight ? 13 : 80);

  // --- Destructive ---
  const destrDarkTone = isLight ? 30 : 20;
  const destrHoverTone = isLight ? 40 : 40;
  const destrActiveTone = isLight ? 50 : 50;

  setChromatic("--tug-base-control-destructive-bg-rest", destructiveHue, dangerAngle, 50, destrDarkTone, 100, dangerName);
  setChromatic("--tug-base-control-destructive-bg-hover", destructiveHue, dangerAngle, 55, destrHoverTone, 100, dangerName);
  setChromatic("--tug-base-control-destructive-bg-active", destructiveHue, dangerAngle, 90, destrActiveTone, 100, dangerName);
  setStructural("--tug-base-control-destructive-bg-disabled", "var(--tug-base-control-disabled-bg)");
  setChromatic("--tug-base-control-destructive-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);
  setChromatic("--tug-base-control-destructive-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);
  setChromatic("--tug-base-control-destructive-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);
  setChromatic("--tug-base-control-destructive-border-rest", destructiveHue, dangerAngle, 30, Math.round(destrDarkTone + 10), 100, dangerName);
  setChromatic("--tug-base-control-destructive-border-hover", destructiveHue, dangerAngle, 40, 50, 100, dangerName);
  setChromatic("--tug-base-control-destructive-border-active", destructiveHue, dangerAngle, 90, destrActiveTone, 100, dangerName);
  setChromatic("--tug-base-control-destructive-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);
  setChromatic("--tug-base-control-destructive-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);
  setChromatic("--tug-base-control-destructive-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), primaryFgTone);

  // --- Selected / Highlighted ---
  setChromatic("--tug-base-control-selected-bg", primaryRef, primaryAngle, signalI, 50, 18, primaryName);
  setChromatic("--tug-base-control-selected-bg-hover", primaryRef, primaryAngle, signalI, 50, 24, primaryName);
  setChromatic("--tug-base-control-selected-fg", txtRefW, txtAngleW, txtI, fgDefaultTone);
  setChromatic("--tug-base-control-selected-border", primaryRef, primaryAngle, signalI, 50, 100, primaryName);
  setChromatic("--tug-base-control-selected-disabled-bg", primaryRef, primaryAngle, signalI, 50, 10, primaryName);
  setChromatic("--tug-base-control-highlighted-bg", primaryRef, primaryAngle, signalI, 50, 10, primaryName);
  setChromatic("--tug-base-control-highlighted-fg", txtRefW, txtAngleW, txtI, fgDefaultTone);
  setChromatic("--tug-base-control-highlighted-border", primaryRef, primaryAngle, signalI, 50, 25, primaryName);

  // --- Generic Field Tokens ---
  const fieldBgRestTone = isLight ? 51 : 8;
  const fieldBgHoverTone = isLight ? 74 : 11;
  const fieldBgFocusTone = isLight ? 99 : 7;
  const fieldBgDisabledTone = isLight ? 48 : 6;
  const fieldBgReadOnlyTone = isLight ? 74 : 11;

  setChromatic("--tug-base-field-bg-rest", atmRefW, atmAngleW, isLight ? 7 : 5, fieldBgRestTone);
  setChromatic("--tug-base-field-bg-hover", atmRefW, atmAngleW, atmI, fieldBgHoverTone);
  setChromatic("--tug-base-field-bg-focus", atmRefW, atmAngleW, isLight ? 4 : 4, fieldBgFocusTone);
  setChromatic("--tug-base-field-bg-disabled", atmRefW, atmAngleW, atmI, fieldBgDisabledTone);
  setChromatic("--tug-base-field-bg-readOnly", atmRefW, atmAngleW, atmI, fieldBgReadOnlyTone);

  setChromatic("--tug-base-field-fg", txtRefW, txtAngleW, txtI, fgDefaultTone);
  setChromatic("--tug-base-field-fg-disabled", txtRefW, txtAngleW, txtISubtle, fgDisabledTone);
  setChromatic("--tug-base-field-fg-readOnly", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
  // field-placeholder / field-border: in light mode use atmosphere hue (Harmony pattern)
  if (isLight) {
    setChromatic("--tug-base-field-placeholder", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
    setChromatic("--tug-base-field-border-rest", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
    // field-border-hover in light mode: Harmony uses yellow-5 (same as border-strong: atm-5°)
    setChromatic("--tug-base-field-border-hover", borderStrongHueRef, borderStrongHueAngle, borderIStrong, borderStrongTone, 100, borderStrongHueName);
  } else {
    setChromatic("--tug-base-field-placeholder", txtRefW, txtAngleW, txtISubtle, fgPlaceholderTone);
    setChromatic("--tug-base-field-border-rest", txtRefW, txtAngleW, txtISubtle, fgPlaceholderTone);
    setChromatic("--tug-base-field-border-hover", txtRefW, txtAngleW, txtISubtle, fgSubtleTone);
  }
  setChromatic("--tug-base-field-border-focus", infoHue, infoAngle, signalI, 50, 100, infoName);
  setChromatic("--tug-base-field-border-invalid", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-field-border-valid", successHue, successAngle, signalI, 50, 100, successName);
  setChromatic("--tug-base-field-border-disabled", atmRefW, atmAngleW, atmIBorder, Math.round(dividerTone));
  setChromatic("--tug-base-field-border-readOnly", atmRefW, atmAngleW, atmIBorder, Math.round(dividerTone));

  // field-helper, field-meta: in light mode use atmosphere hue at placeholder tone.
  // Harmony: yellow, i:9, t:28 (= fgPlaceholderTone, not fgSubtleTone).
  if (isLight) {
    setChromatic("--tug-base-field-helper", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
    setChromatic("--tug-base-field-label", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
    setChromatic("--tug-base-field-required", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
    setChromatic("--tug-base-field-meta", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
    setChromatic("--tug-base-field-counter", txtRefW, txtAngleW, txtISubtle, fgSubtleTone);
  } else {
    setChromatic("--tug-base-field-helper", txtRefW, txtAngleW, txtISubtle, fgSubtleTone);
    setChromatic("--tug-base-field-label", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
    setChromatic("--tug-base-field-required", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
    setChromatic("--tug-base-field-meta", txtRefW, txtAngleW, txtISubtle, fgSubtleTone);
    setChromatic("--tug-base-field-counter", txtRefW, txtAngleW, txtISubtle, fgSubtleTone);
  }
  setChromatic("--tug-base-field-limit", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-field-dirty", cautionHue, cautionAngle, signalI, 50, 100, cautionName);
  setChromatic("--tug-base-field-readOnly", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
  setChromatic("--tug-base-field-error", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-field-warning", cautionHue, cautionAngle, signalI, 50, 100, cautionName);
  setChromatic("--tug-base-field-success", successHue, successAngle, signalI, 50, 100, successName);

  // --- Toggle / Range Tokens ---
  // Toggle track: atmosphere (off) or accent (on)
  const toggleTrackOffTone = Math.round(dividerTone);
  setChromatic("--tug-base-toggle-track-off", atmRefW, atmAngleW, atmIBorder, toggleTrackOffTone);
  setChromatic("--tug-base-toggle-track-off-hover", atmRefW, atmAngleW, Math.min(atmIBorder + 4, 100), Math.min(toggleTrackOffTone + 8, 100));
  setChromatic("--tug-base-toggle-track-on", accentHue, accentAngle, signalI, 50, 100, accentName);
  setChromatic("--tug-base-toggle-track-on-hover", accentHue, accentAngle, Math.min(signalI + 5, 100), isLight ? 40 : 45, 100, accentName);
  // toggle-track-disabled: light mode uses overlay tone (Harmony: yellow, i:6, t:48)
  const toggleDisabledTone = isLight ? Math.round(darkSurfaceOverlay) : Math.round(darkSurfaceSunken);
  setChromatic("--tug-base-toggle-track-disabled", atmRefW, atmAngleW, isLight ? 6 : atmI, toggleDisabledTone, 100, atmNameW);
  setChromatic("--tug-base-toggle-track-mixed", txtRefW, txtAngleW, txtISubtle, fgSubtleTone);
  setChromatic("--tug-base-toggle-track-mixed-hover", txtRefW, txtAngleW, Math.min(txtISubtle + 5, 100), Math.min(fgSubtleTone + 6, 100));

  // Thumb: near-white (text inverse) in dark mode; white in light mode
  if (isLight) {
    setWhite("--tug-base-toggle-thumb");
  } else {
    setChromatic("--tug-base-toggle-thumb", txtRefW, txtAngleW, Math.max(1, txtI - 1), fgInverseTone);
  }
  setChromatic("--tug-base-toggle-thumb-disabled", txtRefW, txtAngleW, txtISubtle, fgDisabledTone);
  setChromatic("--tug-base-toggle-icon-disabled", txtRefW, txtAngleW, txtISubtle, fgDisabledTone);
  setChromatic("--tug-base-toggle-icon-mixed", txtRefW, txtAngleW, txtISubtle, fgMutedTone);

  // Checkmark / radio: same as thumb
  if (isLight) {
    setWhite("--tug-base-checkmark");
    setWhite("--tug-base-radio-dot");
  } else {
    setChromatic("--tug-base-checkmark", txtRefW, txtAngleW, Math.max(1, txtI - 1), fgInverseTone);
    setChromatic("--tug-base-radio-dot", txtRefW, txtAngleW, Math.max(1, txtI - 1), fgInverseTone);
  }
  setChromatic("--tug-base-checkmark-mixed", txtRefW, txtAngleW, txtISubtle, fgMutedTone);

  // Range
  setChromatic("--tug-base-range-track", atmRefW, atmAngleW, atmIBorder, toggleTrackOffTone);
  setChromatic("--tug-base-range-fill", accentHue, accentAngle, signalI, 50, 100, accentName);
  if (isLight) {
    setWhite("--tug-base-range-thumb");
  } else {
    setChromatic("--tug-base-range-thumb", txtRefW, txtAngleW, Math.max(1, txtI - 1), fgInverseTone);
  }
  setChromatic("--tug-base-range-thumb-disabled", txtRefW, txtAngleW, txtISubtle, fgDisabledTone);
  // range-tick: in light mode uses atmosphere hue (Harmony: yellow i:9 t:28)
  if (isLight) {
    setChromatic("--tug-base-range-tick", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
  } else {
    setChromatic("--tug-base-range-tick", txtRefW, txtAngleW, txtISubtle, fgPlaceholderTone);
  }
  setChromatic("--tug-base-range-scrub-active", accentHue, accentAngle, signalI, 50, 30, accentName);
  setChromatic("--tug-base-range-label", txtRefW, txtAngleW, txtISubtle, fgSubtleTone);
  setChromatic("--tug-base-range-annotation", txtRefW, txtAngleW, txtISubtle, fgSubtleTone);
  setChromatic("--tug-base-range-value", txtRefW, txtAngleW, txtI, fgDefaultTone);

  // --- Scroll Area / Separator / Avatar ---
  setStructural("--tug-base-scrollbar-track", "transparent");
  // scrollbar-thumb: in light mode uses atmosphere hue (Harmony: yellow i:9 t:28)
  if (isLight) {
    setChromatic("--tug-base-scrollbar-thumb", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
    // scrollbar-thumb-hover: Harmony uses yellow-5 (same as border-strong)
    setChromatic("--tug-base-scrollbar-thumb-hover", borderStrongHueRef, borderStrongHueAngle, borderIStrong, borderStrongTone, 100, borderStrongHueName);
  } else {
    setChromatic("--tug-base-scrollbar-thumb", txtRefW, txtAngleW, txtISubtle, fgPlaceholderTone);
    setChromatic("--tug-base-scrollbar-thumb-hover", txtRefW, txtAngleW, txtISubtle, fgSubtleTone);
  }
  setChromatic("--tug-base-separator", atmRefW, atmAngleW, atmIBorder, toggleTrackOffTone);
  // avatar-bg: light mode uses overlay tone (t:48 = darkSurfaceOverlay), not screen tone (t:80).
  const avatarBgTone = isLight ? Math.round(darkSurfaceOverlay) : Math.round(darkSurfaceScreen);
  setChromatic("--tug-base-avatar-bg", atmRefW, atmAngleW, isLight ? 6 : atmI, avatarBgTone, 100, atmNameW);
  setChromatic("--tug-base-avatar-fg", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
  // avatar-ring: in light mode uses atmosphere hue (Harmony: yellow i:9 t:28)
  if (isLight) {
    setChromatic("--tug-base-avatar-ring", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
  } else {
    setChromatic("--tug-base-avatar-ring", txtRefW, txtAngleW, txtISubtle, fgPlaceholderTone);
  }

  // =========================================================================
  // Return ThemeOutput
  // =========================================================================
  return {
    name: recipe.name,
    mode: recipe.mode,
    tokens,
    resolved,
    contrastResults: [],
    cvdWarnings: [],
  };
}

// ---------------------------------------------------------------------------
// Utility: isValidSRGBColor — gamut check for resolved colors
// ---------------------------------------------------------------------------

/**
 * Check whether a resolved color is within the sRGB gamut.
 * Used by tests (T2.6) to verify non-overridden token reasonableness.
 */
export function isValidSRGBResolvedColor(color: ResolvedColor): boolean {
  return isInSRGBGamut(color.L, color.C, color.h);
}
