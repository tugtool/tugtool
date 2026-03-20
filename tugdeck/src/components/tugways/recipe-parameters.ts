/**
 * Recipe Parameters — Design Parameter Compilation Pipeline
 *
 * Defines the 7 design parameters (0-100) that replace the three mood knobs
 * (surfaceContrast, signalIntensity, warmth). Provides compileRecipe() which
 * takes a mode and RecipeParameters and produces a complete DerivationFormulas.
 *
 * Architecture:
 *   1. DARK_STRUCTURAL_TEMPLATE / LIGHT_STRUCTURAL_TEMPLATE — ~71 structural
 *      (routing) fields copied verbatim; not slider-controlled.
 *   2. DARK_ENDPOINTS / LIGHT_ENDPOINTS — 7 parameter endpoint pairs per mode.
 *      Each pair has a `low` (parameter=0) and `high` (parameter=100) map.
 *      Placeholder offsets: low = ref * 0.5, high = ref * 1.5 (clamped).
 *   3. compileRecipe() — interpolates each parameter's fields between its
 *      endpoints and overlays them onto the structural template.
 *
 * Design decisions:
 *   [D01] Seven design parameters replace three mood knobs
 *   [D03] Linear interpolation between curated endpoints
 *   [D04] surfaceContrast scaling absorbed into endpoint bundles
 *   [D05] Structural fields from mode templates, not interpolated
 *
 * @module components/tugways/recipe-parameters
 */

import type { DerivationFormulas } from "./theme-derivation-engine";

// ---------------------------------------------------------------------------
// RecipeParameters interface — Spec S01
// ---------------------------------------------------------------------------

/**
 * Seven design parameters that control visual character. All values 0-100.
 * Use defaultParameters() for all-50 defaults.
 *
 * Spec S01.
 */
export interface RecipeParameters {
  /** P1: Surface Depth — tonal separation between surface layers. 0=flat, 100=deep. */
  surfaceDepth: number; // 0-100, default 50
  /** P2: Text Hierarchy — spread between text levels. 0=democratic, 100=strong order. */
  textHierarchy: number; // 0-100, default 50
  /** P3: Control Weight — visual heaviness of controls. 0=light, 100=bold. */
  controlWeight: number; // 0-100, default 50
  /** P4: Border Definition — visibility of structural boundaries. 0=minimal, 100=strong. */
  borderDefinition: number; // 0-100, default 50
  /** P5: Shadow Depth — elevation prominence. 0=flat, 100=deep. */
  shadowDepth: number; // 0-100, default 50
  /** P6: Signal Strength — semantic color vividness. 0=muted, 100=vivid. */
  signalStrength: number; // 0-100, default 50
  /** P7: Atmosphere — chromatic character of neutral surfaces. 0=achromatic, 100=tinted. */
  atmosphere: number; // 0-100, default 50
}

// ---------------------------------------------------------------------------
// defaultParameters — Spec S02
// ---------------------------------------------------------------------------

/**
 * Returns RecipeParameters with all 7 fields set to 50.
 * At V=50 with placeholder offsets (low=ref*0.5, high=ref*1.5),
 * interpolation reproduces the reference DARK_FORMULAS/LIGHT_FORMULAS values.
 *
 * Spec S02.
 */
export function defaultParameters(): RecipeParameters {
  return {
    surfaceDepth: 50,
    textHierarchy: 50,
    controlWeight: 50,
    borderDefinition: 50,
    shadowDepth: 50,
    signalStrength: 50,
    atmosphere: 50,
  };
}

// ---------------------------------------------------------------------------
// ParameterEndpoints — Spec S04
// ---------------------------------------------------------------------------

/**
 * Low (0) and high (100) field values for one parameter in one mode.
 * Spec S04.
 */
interface ParameterEndpoints {
  low: Record<string, number>; // field values at parameter = 0
  high: Record<string, number>; // field values at parameter = 100
}

/**
 * All 7 endpoint pairs for one mode.
 * Spec S04.
 */
type ModeEndpoints = Record<keyof RecipeParameters, ParameterEndpoints>;

// ---------------------------------------------------------------------------
// Clamp helpers
// ---------------------------------------------------------------------------

function clampTone(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function clampAlpha(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function clampIntensity(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/**
 * Compute placeholder endpoints for a tone field, guaranteeing that V=50
 * reproduces the reference value (arithmetic mean of low and high = ref).
 *
 * Strategy:
 *   - If ref * 1.5 <= 100: low = ref * 0.5, high = ref * 1.5 (symmetric ±50%)
 *   - If ref * 1.5 > 100: high = 100, low = 2 * ref - 100 (clamped to 0)
 *     This ensures low + 0.5 * (high - low) = ref even when the upper ceiling
 *     forces the high endpoint to 100.
 */
function toneEndpoints(ref: number): { low: number; high: number } {
  if (ref * 1.5 <= 100) {
    return { low: clampTone(ref * 0.5), high: clampTone(ref * 1.5) };
  }
  return { low: clampTone(2 * ref - 100), high: 100 };
}

/**
 * Compute wide endpoints for a tone field using maximum range while
 * preserving the midpoint constraint (low + 0.5 * (high - low) = ref).
 *
 * Strategy:
 *   - If ref <= 50: low = 0, high = 2 * ref (floor-anchored, widest possible range)
 *   - If ref > 50:  low = 2 * ref - 100, high = 100 (ceiling-anchored)
 *
 * This doubles the visual range compared to toneEndpoints() for small-value
 * fields (e.g. dark-mode surface tones), making the slider's effect clearly
 * perceptible at both extremes.
 */
function toneEndpointsWide(ref: number): { low: number; high: number } {
  if (ref <= 50) {
    return { low: 0, high: clampTone(2 * ref) };
  }
  return { low: clampTone(2 * ref - 100), high: 100 };
}

/**
 * Compute wide endpoints for an intensity field, same strategy as
 * toneEndpointsWide. Used where small reference intensities would produce
 * an imperceptibly narrow range with the default ±50% strategy.
 */
function intensityEndpointsWide(ref: number): { low: number; high: number } {
  if (ref <= 50) {
    return { low: 0, high: clampIntensity(2 * ref) };
  }
  return { low: clampIntensity(2 * ref - 100), high: 100 };
}

/**
 * Compute placeholder endpoints for an intensity field, guaranteeing that
 * V=50 reproduces the reference value.
 *
 * Same midpoint-preserving strategy as toneEndpoints.
 */
function intensityEndpoints(ref: number): { low: number; high: number } {
  if (ref * 1.5 <= 100) {
    return { low: clampIntensity(ref * 0.5), high: clampIntensity(ref * 1.5) };
  }
  return { low: clampIntensity(2 * ref - 100), high: 100 };
}

/**
 * Compute placeholder endpoints for an alpha field, guaranteeing that
 * V=50 reproduces the reference value.
 *
 * Same midpoint-preserving strategy as toneEndpoints.
 */
function alphaEndpoints(ref: number): { low: number; high: number } {
  if (ref * 1.5 <= 100) {
    return { low: clampAlpha(ref * 0.5), high: clampAlpha(ref * 1.5) };
  }
  return { low: clampAlpha(2 * ref - 100), high: 100 };
}

// ---------------------------------------------------------------------------
// DARK_STRUCTURAL_TEMPLATE — ~71 structural fields from DARK_FORMULAS [D05]
// ---------------------------------------------------------------------------

/**
 * Structural (routing) fields from the Dark recipe. These fields determine
 * which hue slot each token uses and are not slider-controlled. Copied
 * verbatim into the compiled formula output before parameter overlay. [D05]
 *
 * Groups: hue-slot-dispatch, sentinel-hue-dispatch, hue-name-dispatch,
 *         selection-mode (selectionInactiveSemanticMode flag only),
 *         computed-tone-override (outlinedSurfaceRestToneOverride,
 *         outlinedSurfaceHoverToneOverride, outlinedSurfaceActiveToneOverride,
 *         toggleTrackOffToneOverride, toggleDisabledToneOverride).
 *
 * NOTE: dividerDefaultToneOverride, dividerMutedToneOverride,
 * disabledBorderToneOverride, borderStrongToneComputed are assigned to P4 and
 * are not in this template. disabledTextToneComputed is assigned to P2.
 * surfaceCanvasToneBase/Center/Scale are assigned to P1.
 * disabledSurfaceToneBase/Scale are assigned to P7.
 */
export const DARK_STRUCTURAL_TEMPLATE: Partial<DerivationFormulas> = {
  // ===== Hue Slot Dispatch =====
  surfaceAppHueSlot: "canvas",
  surfaceCanvasHueSlot: "canvas",
  surfaceSunkenHueSlot: "surfBareBase",
  surfaceDefaultHueSlot: "surfBareBase",
  surfaceRaisedHueSlot: "atm",
  surfaceOverlayHueSlot: "surfBareBase",
  surfaceInsetHueSlot: "atm",
  surfaceContentHueSlot: "atm",
  surfaceScreenHueSlot: "surfScreen",
  mutedTextHueSlot: "fgMuted",
  subtleTextHueSlot: "fgSubtle",
  disabledTextHueSlot: "fgDisabled",
  placeholderTextHueSlot: "fgPlaceholder",
  inverseTextHueSlot: "fgInverse",
  onAccentTextHueSlot: "fgInverse",
  iconMutedHueSlot: "fgSubtle",
  iconOnAccentHueSlot: "fgInverse",
  dividerMutedHueSlot: "borderTintBareBase",
  disabledSurfaceHueSlot: "surfBareBase",
  fieldSurfaceHoverHueSlot: "surfBareBase",
  fieldSurfaceReadOnlyHueSlot: "surfBareBase",
  fieldPlaceholderHueSlot: "fgPlaceholder",
  fieldBorderRestHueSlot: "fgPlaceholder",
  fieldBorderHoverHueSlot: "fgSubtle",
  toggleTrackDisabledHueSlot: "surfBareBase",
  toggleThumbHueSlot: "fgInverse",
  checkmarkHueSlot: "fgInverse",
  radioDotHueSlot: "fgInverse",
  tabSurfaceActiveHueSlot: "cardFrame",
  tabSurfaceInactiveHueSlot: "cardFrame",

  // ===== Sentinel Hue Dispatch =====
  outlinedSurfaceHoverHueSlot: "__highlight",
  outlinedSurfaceActiveHueSlot: "__highlight",
  ghostActionSurfaceHoverHueSlot: "__highlight",
  ghostActionSurfaceActiveHueSlot: "__highlight",
  ghostOptionSurfaceHoverHueSlot: "__highlight",
  ghostOptionSurfaceActiveHueSlot: "__highlight",
  tabSurfaceHoverHueSlot: "__highlight",
  tabCloseSurfaceHoverHueSlot: "__highlight",
  highlightHoverHueSlot: "__verboseHighlight",

  // ===== Hue Name Dispatch =====
  surfaceScreenHueExpression: "indigo",
  mutedTextHueExpression: "__bare_primary",
  subtleTextHueExpression: "indigo-cobalt",
  disabledTextHueExpression: "indigo-cobalt",
  inverseTextHueExpression: "sapphire-cobalt",
  placeholderTextHueExpression: "fgMuted",
  selectionInactiveHueExpression: "yellow",

  // ===== Selection Mode (flag only; numeric fields are P6) =====
  selectionInactiveSemanticMode: true,

  // ===== Computed Tone Override (override flags; numeric params are P1/P2/P4/P7) =====
  outlinedSurfaceRestToneOverride: null,
  outlinedSurfaceHoverToneOverride: null,
  outlinedSurfaceActiveToneOverride: null,
  toggleTrackOffToneOverride: 28,
  toggleDisabledToneOverride: 22,
};

// ---------------------------------------------------------------------------
// LIGHT_STRUCTURAL_TEMPLATE — ~71 structural fields from LIGHT_FORMULAS [D05]
// ---------------------------------------------------------------------------

/**
 * Structural (routing) fields from the Light recipe. Same set as
 * DARK_STRUCTURAL_TEMPLATE but with light-mode-specific values where
 * they differ. [D05]
 */
export const LIGHT_STRUCTURAL_TEMPLATE: Partial<DerivationFormulas> = {
  // ===== Hue Slot Dispatch (mode-independent — same as dark) =====
  surfaceAppHueSlot: "canvas",
  surfaceCanvasHueSlot: "canvas",
  surfaceSunkenHueSlot: "surfBareBase",
  surfaceDefaultHueSlot: "surfBareBase",
  surfaceRaisedHueSlot: "atm",
  surfaceOverlayHueSlot: "surfBareBase",
  surfaceInsetHueSlot: "atm",
  surfaceContentHueSlot: "atm",
  surfaceScreenHueSlot: "surfScreen",
  mutedTextHueSlot: "fgMuted",
  subtleTextHueSlot: "fgSubtle",
  disabledTextHueSlot: "fgDisabled",
  placeholderTextHueSlot: "fgPlaceholder",
  inverseTextHueSlot: "fgInverse",
  onAccentTextHueSlot: "fgInverse",
  iconMutedHueSlot: "fgSubtle",
  iconOnAccentHueSlot: "fgInverse",
  dividerMutedHueSlot: "borderTintBareBase",
  disabledSurfaceHueSlot: "surfBareBase",
  fieldSurfaceHoverHueSlot: "surfBareBase",
  fieldSurfaceReadOnlyHueSlot: "surfBareBase",
  fieldPlaceholderHueSlot: "fgPlaceholder",
  fieldBorderRestHueSlot: "fgPlaceholder",
  fieldBorderHoverHueSlot: "fgSubtle",
  toggleTrackDisabledHueSlot: "surfBareBase",
  toggleThumbHueSlot: "fgInverse",
  checkmarkHueSlot: "fgInverse",
  radioDotHueSlot: "fgInverse",
  tabSurfaceActiveHueSlot: "cardFrame",
  tabSurfaceInactiveHueSlot: "cardFrame",

  // ===== Sentinel Hue Dispatch (mode-independent — same as dark) =====
  outlinedSurfaceHoverHueSlot: "__highlight",
  outlinedSurfaceActiveHueSlot: "__highlight",
  ghostActionSurfaceHoverHueSlot: "__highlight",
  ghostActionSurfaceActiveHueSlot: "__highlight",
  ghostOptionSurfaceHoverHueSlot: "__highlight",
  ghostOptionSurfaceActiveHueSlot: "__highlight",
  tabSurfaceHoverHueSlot: "__highlight",
  tabCloseSurfaceHoverHueSlot: "__highlight",
  highlightHoverHueSlot: "__verboseHighlight",

  // ===== Hue Name Dispatch (light-mode overrides) =====
  surfaceScreenHueExpression: "cobalt",
  mutedTextHueExpression: "__bare_primary",
  subtleTextHueExpression: "indigo-cobalt",
  disabledTextHueExpression: "indigo-cobalt",
  inverseTextHueExpression: "sapphire-cobalt",
  placeholderTextHueExpression: "atm",
  selectionInactiveHueExpression: "yellow",

  // ===== Selection Mode (flag only; numeric fields are P6) =====
  selectionInactiveSemanticMode: false,

  // ===== Computed Tone Override (override flags; numeric params are P1/P2/P4/P7) =====
  outlinedSurfaceRestToneOverride: null,
  outlinedSurfaceHoverToneOverride: null,
  outlinedSurfaceActiveToneOverride: null,
  toggleTrackOffToneOverride: 72,
  toggleDisabledToneOverride: 80,
};

// ---------------------------------------------------------------------------
// DARK_ENDPOINTS — 7 parameter endpoint pairs for dark mode
// Placeholder offsets: low = ref * 0.5 (clamped), high = ref * 1.5 (clamped)
// Where ref = DARK_FORMULAS value for that field.
// At V=50: interpolated value = low + 0.5 * (high - low) = ref (arithmetic mean)
// ---------------------------------------------------------------------------

/**
 * Endpoint bundles for all 7 parameters in dark mode.
 * Step 7 visual calibration: P1 dark-mode surface tones use toneEndpointsWide()
 * to ensure the slider's full sweep (0–100) produces a clearly perceptible
 * tonal range. Small reference values (5–16) would otherwise give a visually
 * imperceptible ±50% range of only 2–8 tone units.
 *
 * P1: Surface Depth — 19 fields (canvas-darkness, surface-layering,
 *     surface-coloring subset, computed-tone-override: surfaceCanvasToneBase/Center/Scale)
 *
 * NOTE: surfaceCanvasToneScale is set to 0 in compiled output to neutralize
 * computeTones() surface-contrast scaling per [D04]. The endpoint bundles
 * reflect this: both low and high have scale=0. surfaceCanvasToneCenter is
 * fixed at 50 in both endpoints.
 */
const DARK_P1_ENDPOINTS: ParameterEndpoints = (() => {
  // Tone fields — wide range: low = 0, high = 2 * ref (maintains midpoint = ref at V=50)
  const surfaceAppTone = toneEndpointsWide(5);
  const surfaceCanvasTone = toneEndpointsWide(5);
  const surfaceSunkenTone = toneEndpointsWide(11);
  const surfaceDefaultTone = toneEndpointsWide(12);
  const surfaceRaisedTone = toneEndpointsWide(11);
  const surfaceOverlayTone = toneEndpointsWide(14);
  const surfaceInsetTone = toneEndpointsWide(6);
  const surfaceContentTone = toneEndpointsWide(6);
  const surfaceScreenTone = toneEndpointsWide(16);
  // Intensity fields — wide range for same reason as tone fields
  const surfaceDefaultIntensity = intensityEndpointsWide(5);
  const surfaceRaisedIntensity = intensityEndpointsWide(5);
  const surfaceOverlayIntensity = intensityEndpointsWide(4);
  const surfaceScreenIntensity = intensityEndpointsWide(7);
  const surfaceInsetIntensity = intensityEndpointsWide(5);
  const surfaceContentIntensity = intensityEndpointsWide(5);
  const surfaceAppBaseIntensity = intensityEndpointsWide(2);
  return {
    low: {
      surfaceAppTone: surfaceAppTone.low,
      surfaceCanvasTone: surfaceCanvasTone.low,
      surfaceSunkenTone: surfaceSunkenTone.low,
      surfaceDefaultTone: surfaceDefaultTone.low,
      surfaceRaisedTone: surfaceRaisedTone.low,
      surfaceOverlayTone: surfaceOverlayTone.low,
      surfaceInsetTone: surfaceInsetTone.low,
      surfaceContentTone: surfaceContentTone.low,
      surfaceScreenTone: surfaceScreenTone.low,
      surfaceDefaultIntensity: surfaceDefaultIntensity.low,
      surfaceRaisedIntensity: surfaceRaisedIntensity.low,
      surfaceOverlayIntensity: surfaceOverlayIntensity.low,
      surfaceScreenIntensity: surfaceScreenIntensity.low,
      surfaceInsetIntensity: surfaceInsetIntensity.low,
      surfaceContentIntensity: surfaceContentIntensity.low,
      surfaceAppBaseIntensity: surfaceAppBaseIntensity.low,
      // Neutralize computeTones() surface-contrast scaling [D04]
      surfaceCanvasToneBase: surfaceCanvasTone.low,
      surfaceCanvasToneCenter: 50,
      surfaceCanvasToneScale: 0,
    },
    high: {
      surfaceAppTone: surfaceAppTone.high,
      surfaceCanvasTone: surfaceCanvasTone.high,
      surfaceSunkenTone: surfaceSunkenTone.high,
      surfaceDefaultTone: surfaceDefaultTone.high,
      surfaceRaisedTone: surfaceRaisedTone.high,
      surfaceOverlayTone: surfaceOverlayTone.high,
      surfaceInsetTone: surfaceInsetTone.high,
      surfaceContentTone: surfaceContentTone.high,
      surfaceScreenTone: surfaceScreenTone.high,
      surfaceDefaultIntensity: surfaceDefaultIntensity.high,
      surfaceRaisedIntensity: surfaceRaisedIntensity.high,
      surfaceOverlayIntensity: surfaceOverlayIntensity.high,
      surfaceScreenIntensity: surfaceScreenIntensity.high,
      surfaceInsetIntensity: surfaceInsetIntensity.high,
      surfaceContentIntensity: surfaceContentIntensity.high,
      surfaceAppBaseIntensity: surfaceAppBaseIntensity.high,
      // Neutralize computeTones() surface-contrast scaling [D04]
      surfaceCanvasToneBase: surfaceCanvasTone.high,
      surfaceCanvasToneCenter: 50,
      surfaceCanvasToneScale: 0,
    },
  };
})();

/**
 * P2: Text Hierarchy — 11 fields (text-brightness, text-hierarchy,
 *     text-coloring subset, computed-tone-override: disabledTextToneComputed)
 *
 * Step 7 refinement: hierarchy tones (mutedTextTone, subtleTextTone,
 * disabledTextTone, placeholderTextTone) use toneEndpointsWide() so that
 * P2=0 ("democratic" hierarchy) visibly collapses the separation between
 * primary and secondary text. The ±50% default produced too narrow a range
 * for the low-valued dark-mode tones (23–37).
 */
const DARK_P2_ENDPOINTS: ParameterEndpoints = (() => {
  const contentTextTone = toneEndpoints(94); // ceiling-anchored; already at max range
  const inverseTextTone = toneEndpoints(100); // fixed at 100 in both modes
  const mutedTextTone = toneEndpointsWide(66); // low=32, high=100 (wider than 33/99)
  const subtleTextTone = toneEndpointsWide(37); // low=0, high=74
  const disabledTextTone = toneEndpointsWide(23); // low=0, high=46
  const placeholderTextTone = toneEndpointsWide(30); // low=0, high=60
  const contentTextIntensity = intensityEndpoints(3);
  const subtleTextIntensity = intensityEndpoints(7);
  const mutedTextIntensity = intensityEndpoints(5);
  const inverseTextIntensity = intensityEndpoints(3);
  const disabledTextToneComputed = toneEndpointsWide(38); // low=0, high=76
  return {
    low: {
      contentTextTone: contentTextTone.low,
      inverseTextTone: inverseTextTone.low,
      mutedTextTone: mutedTextTone.low,
      subtleTextTone: subtleTextTone.low,
      disabledTextTone: disabledTextTone.low,
      placeholderTextTone: placeholderTextTone.low,
      contentTextIntensity: contentTextIntensity.low,
      subtleTextIntensity: subtleTextIntensity.low,
      mutedTextIntensity: mutedTextIntensity.low,
      inverseTextIntensity: inverseTextIntensity.low,
      disabledTextToneComputed: disabledTextToneComputed.low,
    },
    high: {
      contentTextTone: contentTextTone.high,
      inverseTextTone: inverseTextTone.high,
      mutedTextTone: mutedTextTone.high,
      subtleTextTone: subtleTextTone.high,
      disabledTextTone: disabledTextTone.high,
      placeholderTextTone: placeholderTextTone.high,
      contentTextIntensity: contentTextIntensity.high,
      subtleTextIntensity: subtleTextIntensity.high,
      mutedTextIntensity: mutedTextIntensity.high,
      inverseTextIntensity: inverseTextIntensity.high,
      disabledTextToneComputed: disabledTextToneComputed.high,
    },
  };
})();

/**
 * P3: Control Weight — 33 roadmap fields + 7 additional outlined/ghost fields
 * from the same semantic group that the roadmap omitted.
 *
 * Roadmap fields: filled-control-prominence, outlined-control-style,
 *                 ghost-control-style.
 *
 * Additional fields included (same semantic groups, missing from roadmap):
 *   outlined-control-style: outlinedIconRestTone, outlinedIconHoverTone,
 *                           outlinedIconActiveTone
 *   ghost-control-style: ghostTextRestTone, ghostTextHoverTone,
 *                        ghostTextActiveTone, ghostIconRestTone,
 *                        ghostIconHoverTone, ghostIconActiveTone,
 *                        ghostIconRestToneLight, ghostIconHoverToneLight,
 *                        ghostIconActiveToneLight
 */
const DARK_P3_ENDPOINTS: ParameterEndpoints = (() => {
  // Filled control — wide range so P3=0 produces a near-invisible button
  // and P3=100 produces a bold, prominent filled button. toneEndpointsWide
  // doubles the visual sweep vs the ±50% default.
  const filledSurfaceRestTone = toneEndpointsWide(20); // low=0, high=40
  const filledSurfaceHoverTone = toneEndpointsWide(40); // low=0, high=80
  const filledSurfaceActiveTone = toneEndpoints(50); // low=25, high=75 (symmetric at midpoint)
  // Outlined control
  const outlinedTextRestTone = toneEndpoints(100);
  const outlinedTextHoverTone = toneEndpoints(100);
  const outlinedTextActiveTone = toneEndpoints(100);
  const outlinedTextIntensity = intensityEndpoints(2);
  const outlinedIconRestTone = toneEndpoints(100);
  const outlinedIconHoverTone = toneEndpoints(100);
  const outlinedIconActiveTone = toneEndpoints(100);
  const outlinedIconIntensity = intensityEndpoints(2);
  const outlinedSurfaceHoverIntensity = intensityEndpoints(0);
  const outlinedSurfaceHoverAlpha = alphaEndpoints(10);
  const outlinedSurfaceActiveIntensity = intensityEndpoints(0);
  const outlinedSurfaceActiveAlpha = alphaEndpoints(20);
  const outlinedOptionBorderRestTone = toneEndpoints(50);
  const outlinedOptionBorderHoverTone = toneEndpoints(55);
  const outlinedOptionBorderActiveTone = toneEndpoints(60);
  // Light-mode outlined tone counterparts (dark mode: 0 = pure black)
  const outlinedTextRestToneLight = toneEndpoints(0);
  const outlinedTextHoverToneLight = toneEndpoints(0);
  const outlinedTextActiveToneLight = toneEndpoints(0);
  const outlinedIconRestToneLight = toneEndpoints(0);
  const outlinedIconHoverToneLight = toneEndpoints(0);
  const outlinedIconActiveToneLight = toneEndpoints(0);
  // Ghost control
  const ghostTextRestTone = toneEndpoints(100);
  const ghostTextHoverTone = toneEndpoints(100);
  const ghostTextActiveTone = toneEndpoints(100);
  const ghostTextRestIntensity = intensityEndpoints(2);
  const ghostTextHoverIntensity = intensityEndpoints(2);
  const ghostTextActiveIntensity = intensityEndpoints(2);
  const ghostIconRestTone = toneEndpoints(100);
  const ghostIconHoverTone = toneEndpoints(100);
  const ghostIconActiveTone = toneEndpoints(100);
  const ghostIconRestIntensity = intensityEndpoints(2);
  const ghostIconHoverIntensity = intensityEndpoints(2);
  const ghostIconActiveIntensity = intensityEndpoints(2);
  const ghostBorderIntensity = intensityEndpoints(20);
  const ghostBorderTone = toneEndpoints(60);
  // Light-mode ghost tone/intensity counterparts
  const ghostTextRestToneLight = toneEndpoints(0);
  const ghostTextHoverToneLight = toneEndpoints(0);
  const ghostTextActiveToneLight = toneEndpoints(0);
  const ghostTextRestIntensityLight = intensityEndpoints(0);
  const ghostTextHoverIntensityLight = intensityEndpoints(0);
  const ghostTextActiveIntensityLight = intensityEndpoints(0);
  const ghostIconRestToneLight = toneEndpoints(0);
  const ghostIconHoverToneLight = toneEndpoints(0);
  const ghostIconActiveToneLight = toneEndpoints(0);
  const ghostIconActiveIntensityLight = intensityEndpoints(0);
  return {
    low: {
      filledSurfaceRestTone: filledSurfaceRestTone.low,
      filledSurfaceHoverTone: filledSurfaceHoverTone.low,
      filledSurfaceActiveTone: filledSurfaceActiveTone.low,
      outlinedTextRestTone: outlinedTextRestTone.low,
      outlinedTextHoverTone: outlinedTextHoverTone.low,
      outlinedTextActiveTone: outlinedTextActiveTone.low,
      outlinedTextIntensity: outlinedTextIntensity.low,
      outlinedIconRestTone: outlinedIconRestTone.low,
      outlinedIconHoverTone: outlinedIconHoverTone.low,
      outlinedIconActiveTone: outlinedIconActiveTone.low,
      outlinedIconIntensity: outlinedIconIntensity.low,
      outlinedSurfaceHoverIntensity: outlinedSurfaceHoverIntensity.low,
      outlinedSurfaceHoverAlpha: outlinedSurfaceHoverAlpha.low,
      outlinedSurfaceActiveIntensity: outlinedSurfaceActiveIntensity.low,
      outlinedSurfaceActiveAlpha: outlinedSurfaceActiveAlpha.low,
      outlinedOptionBorderRestTone: outlinedOptionBorderRestTone.low,
      outlinedOptionBorderHoverTone: outlinedOptionBorderHoverTone.low,
      outlinedOptionBorderActiveTone: outlinedOptionBorderActiveTone.low,
      outlinedTextRestToneLight: outlinedTextRestToneLight.low,
      outlinedTextHoverToneLight: outlinedTextHoverToneLight.low,
      outlinedTextActiveToneLight: outlinedTextActiveToneLight.low,
      outlinedIconRestToneLight: outlinedIconRestToneLight.low,
      outlinedIconHoverToneLight: outlinedIconHoverToneLight.low,
      outlinedIconActiveToneLight: outlinedIconActiveToneLight.low,
      ghostTextRestTone: ghostTextRestTone.low,
      ghostTextHoverTone: ghostTextHoverTone.low,
      ghostTextActiveTone: ghostTextActiveTone.low,
      ghostTextRestIntensity: ghostTextRestIntensity.low,
      ghostTextHoverIntensity: ghostTextHoverIntensity.low,
      ghostTextActiveIntensity: ghostTextActiveIntensity.low,
      ghostIconRestTone: ghostIconRestTone.low,
      ghostIconHoverTone: ghostIconHoverTone.low,
      ghostIconActiveTone: ghostIconActiveTone.low,
      ghostIconRestIntensity: ghostIconRestIntensity.low,
      ghostIconHoverIntensity: ghostIconHoverIntensity.low,
      ghostIconActiveIntensity: ghostIconActiveIntensity.low,
      ghostBorderIntensity: ghostBorderIntensity.low,
      ghostBorderTone: ghostBorderTone.low,
      ghostTextRestToneLight: ghostTextRestToneLight.low,
      ghostTextHoverToneLight: ghostTextHoverToneLight.low,
      ghostTextActiveToneLight: ghostTextActiveToneLight.low,
      ghostTextRestIntensityLight: ghostTextRestIntensityLight.low,
      ghostTextHoverIntensityLight: ghostTextHoverIntensityLight.low,
      ghostTextActiveIntensityLight: ghostTextActiveIntensityLight.low,
      ghostIconRestToneLight: ghostIconRestToneLight.low,
      ghostIconHoverToneLight: ghostIconHoverToneLight.low,
      ghostIconActiveToneLight: ghostIconActiveToneLight.low,
      ghostIconActiveIntensityLight: ghostIconActiveIntensityLight.low,
    },
    high: {
      filledSurfaceRestTone: filledSurfaceRestTone.high,
      filledSurfaceHoverTone: filledSurfaceHoverTone.high,
      filledSurfaceActiveTone: filledSurfaceActiveTone.high,
      outlinedTextRestTone: outlinedTextRestTone.high,
      outlinedTextHoverTone: outlinedTextHoverTone.high,
      outlinedTextActiveTone: outlinedTextActiveTone.high,
      outlinedTextIntensity: outlinedTextIntensity.high,
      outlinedIconRestTone: outlinedIconRestTone.high,
      outlinedIconHoverTone: outlinedIconHoverTone.high,
      outlinedIconActiveTone: outlinedIconActiveTone.high,
      outlinedIconIntensity: outlinedIconIntensity.high,
      outlinedSurfaceHoverIntensity: outlinedSurfaceHoverIntensity.high,
      outlinedSurfaceHoverAlpha: outlinedSurfaceHoverAlpha.high,
      outlinedSurfaceActiveIntensity: outlinedSurfaceActiveIntensity.high,
      outlinedSurfaceActiveAlpha: outlinedSurfaceActiveAlpha.high,
      outlinedOptionBorderRestTone: outlinedOptionBorderRestTone.high,
      outlinedOptionBorderHoverTone: outlinedOptionBorderHoverTone.high,
      outlinedOptionBorderActiveTone: outlinedOptionBorderActiveTone.high,
      outlinedTextRestToneLight: outlinedTextRestToneLight.high,
      outlinedTextHoverToneLight: outlinedTextHoverToneLight.high,
      outlinedTextActiveToneLight: outlinedTextActiveToneLight.high,
      outlinedIconRestToneLight: outlinedIconRestToneLight.high,
      outlinedIconHoverToneLight: outlinedIconHoverToneLight.high,
      outlinedIconActiveToneLight: outlinedIconActiveToneLight.high,
      ghostTextRestTone: ghostTextRestTone.high,
      ghostTextHoverTone: ghostTextHoverTone.high,
      ghostTextActiveTone: ghostTextActiveTone.high,
      ghostTextRestIntensity: ghostTextRestIntensity.high,
      ghostTextHoverIntensity: ghostTextHoverIntensity.high,
      ghostTextActiveIntensity: ghostTextActiveIntensity.high,
      ghostIconRestTone: ghostIconRestTone.high,
      ghostIconHoverTone: ghostIconHoverTone.high,
      ghostIconActiveTone: ghostIconActiveTone.high,
      ghostIconRestIntensity: ghostIconRestIntensity.high,
      ghostIconHoverIntensity: ghostIconHoverIntensity.high,
      ghostIconActiveIntensity: ghostIconActiveIntensity.high,
      ghostBorderIntensity: ghostBorderIntensity.high,
      ghostBorderTone: ghostBorderTone.high,
      ghostTextRestToneLight: ghostTextRestToneLight.high,
      ghostTextHoverToneLight: ghostTextHoverToneLight.high,
      ghostTextActiveToneLight: ghostTextActiveToneLight.high,
      ghostTextRestIntensityLight: ghostTextRestIntensityLight.high,
      ghostTextHoverIntensityLight: ghostTextHoverIntensityLight.high,
      ghostTextActiveIntensityLight: ghostTextActiveIntensityLight.high,
      ghostIconRestToneLight: ghostIconRestToneLight.high,
      ghostIconHoverToneLight: ghostIconHoverToneLight.high,
      ghostIconActiveToneLight: ghostIconActiveToneLight.high,
      ghostIconActiveIntensityLight: ghostIconActiveIntensityLight.high,
    },
  };
})();

/**
 * P4: Border Definition — 16 fields (border-visibility, card-frame-style,
 *     field-style: disabledBorderIntensity,
 *     computed-tone-override: borderStrongToneComputed, dividerDefaultToneOverride,
 *     dividerMutedToneOverride, disabledBorderToneOverride)
 *
 * NOTE: dividerDefaultToneOverride and dividerMutedToneOverride are normally
 * null (derived from surfaceOverlay). For endpoint purposes, we compute
 * explicit numeric low/high values derived from the dark surfaceOverlay reference (14).
 * At V=50 these produce the same values as the null path:
 *   dividerDefault null path: Math.round(surfaceOverlay - 2) = Math.round(14-2) = 12
 *   But DARK_FORMULAS has dividerDefaultToneOverride: 17 (explicit override)
 *   We use 17 as the reference for these endpoints.
 */
const DARK_P4_ENDPOINTS: ParameterEndpoints = (() => {
  const borderBaseIntensity = intensityEndpoints(6);
  const borderStrongIntensity = intensityEndpoints(7);
  const borderMutedTone = toneEndpoints(37);
  const borderMutedIntensity = intensityEndpoints(7);
  const borderStrongTone = toneEndpoints(40);
  const dividerDefaultIntensity = intensityEndpoints(6);
  const dividerMutedIntensity = intensityEndpoints(4);
  const cardFrameActiveIntensity = intensityEndpoints(12);
  const cardFrameActiveTone = toneEndpoints(16);
  const cardFrameInactiveIntensity = intensityEndpoints(4);
  const cardFrameInactiveTone = toneEndpoints(15);
  const borderStrongToneComputed = toneEndpoints(37);
  const dividerDefaultToneOverride = toneEndpoints(17);
  const dividerMutedToneOverride = toneEndpoints(15);
  const disabledBorderIntensity = intensityEndpoints(6);
  const disabledBorderToneOverride = toneEndpoints(28);
  return {
    low: {
      borderBaseIntensity: borderBaseIntensity.low,
      borderStrongIntensity: borderStrongIntensity.low,
      borderMutedTone: borderMutedTone.low,
      borderMutedIntensity: borderMutedIntensity.low,
      borderStrongTone: borderStrongTone.low,
      dividerDefaultIntensity: dividerDefaultIntensity.low,
      dividerMutedIntensity: dividerMutedIntensity.low,
      cardFrameActiveIntensity: cardFrameActiveIntensity.low,
      cardFrameActiveTone: cardFrameActiveTone.low,
      cardFrameInactiveIntensity: cardFrameInactiveIntensity.low,
      cardFrameInactiveTone: cardFrameInactiveTone.low,
      borderStrongToneComputed: borderStrongToneComputed.low,
      dividerDefaultToneOverride: dividerDefaultToneOverride.low,
      dividerMutedToneOverride: dividerMutedToneOverride.low,
      disabledBorderIntensity: disabledBorderIntensity.low,
      disabledBorderToneOverride: disabledBorderToneOverride.low,
    },
    high: {
      borderBaseIntensity: borderBaseIntensity.high,
      borderStrongIntensity: borderStrongIntensity.high,
      borderMutedTone: borderMutedTone.high,
      borderMutedIntensity: borderMutedIntensity.high,
      borderStrongTone: borderStrongTone.high,
      dividerDefaultIntensity: dividerDefaultIntensity.high,
      dividerMutedIntensity: dividerMutedIntensity.high,
      cardFrameActiveIntensity: cardFrameActiveIntensity.high,
      cardFrameActiveTone: cardFrameActiveTone.high,
      cardFrameInactiveIntensity: cardFrameInactiveIntensity.high,
      cardFrameInactiveTone: cardFrameInactiveTone.high,
      borderStrongToneComputed: borderStrongToneComputed.high,
      dividerDefaultToneOverride: dividerDefaultToneOverride.high,
      dividerMutedToneOverride: dividerMutedToneOverride.high,
      disabledBorderIntensity: disabledBorderIntensity.high,
      disabledBorderToneOverride: disabledBorderToneOverride.high,
    },
  };
})();

/**
 * P5: Shadow Depth — 8 fields (shadow-depth)
 */
const DARK_P5_ENDPOINTS: ParameterEndpoints = (() => {
  const shadowXsAlpha = alphaEndpoints(20);
  const shadowMdAlpha = alphaEndpoints(60);
  const shadowLgAlpha = alphaEndpoints(70);
  const shadowXlAlpha = alphaEndpoints(80);
  const shadowOverlayAlpha = alphaEndpoints(60);
  const overlayDimAlpha = alphaEndpoints(48);
  const overlayScrimAlpha = alphaEndpoints(64);
  const overlayHighlightAlpha = alphaEndpoints(6);
  return {
    low: {
      shadowXsAlpha: shadowXsAlpha.low,
      shadowMdAlpha: shadowMdAlpha.low,
      shadowLgAlpha: shadowLgAlpha.low,
      shadowXlAlpha: shadowXlAlpha.low,
      shadowOverlayAlpha: shadowOverlayAlpha.low,
      overlayDimAlpha: overlayDimAlpha.low,
      overlayScrimAlpha: overlayScrimAlpha.low,
      overlayHighlightAlpha: overlayHighlightAlpha.low,
    },
    high: {
      shadowXsAlpha: shadowXsAlpha.high,
      shadowMdAlpha: shadowMdAlpha.high,
      shadowLgAlpha: shadowLgAlpha.high,
      shadowXlAlpha: shadowXlAlpha.high,
      shadowOverlayAlpha: shadowOverlayAlpha.high,
      overlayDimAlpha: overlayDimAlpha.high,
      overlayScrimAlpha: overlayScrimAlpha.high,
      overlayHighlightAlpha: overlayHighlightAlpha.high,
    },
  };
})();

/**
 * P6: Signal Strength — 29 roadmap fields + 5 extra signal-tone fields.
 *
 * Extra fields assigned to P6 (signal-tone semantics, omitted from roadmap):
 *   borderSignalTone, semanticSignalTone, accentSubtleTone, cautionSurfaceTone,
 *   signalIntensityValue (new field for computeTones() signalIntensity derivation)
 */
const DARK_P6_ENDPOINTS: ParameterEndpoints = (() => {
  const onCautionTextIntensity = intensityEndpoints(4);
  const onSuccessTextIntensity = intensityEndpoints(4);
  const badgeTintedTextIntensity = intensityEndpoints(72);
  const badgeTintedTextTone = toneEndpoints(85);
  const badgeTintedSurfaceIntensity = intensityEndpoints(65);
  const badgeTintedSurfaceTone = toneEndpoints(60);
  const badgeTintedSurfaceAlpha = alphaEndpoints(15);
  const badgeTintedBorderIntensity = intensityEndpoints(50);
  const badgeTintedBorderTone = toneEndpoints(50);
  const badgeTintedBorderAlpha = alphaEndpoints(35);
  const iconActiveTone = toneEndpoints(80);
  const iconMutedIntensity = intensityEndpoints(7);
  const iconMutedTone = toneEndpoints(37);
  const tabTextActiveTone = toneEndpoints(90);
  const toggleTrackOnHoverTone = toneEndpoints(45);
  const toggleThumbDisabledTone = toneEndpoints(40);
  const toggleTrackDisabledIntensity = intensityEndpoints(5);
  const ghostActionSurfaceHoverAlpha = alphaEndpoints(10);
  const ghostActionSurfaceActiveAlpha = alphaEndpoints(20);
  const ghostOptionSurfaceHoverAlpha = alphaEndpoints(10);
  const ghostOptionSurfaceActiveAlpha = alphaEndpoints(20);
  const ghostDangerSurfaceHoverAlpha = alphaEndpoints(10);
  const ghostDangerSurfaceActiveAlpha = alphaEndpoints(20);
  const tabSurfaceHoverAlpha = alphaEndpoints(8);
  const tabCloseSurfaceHoverAlpha = alphaEndpoints(12);
  const highlightHoverAlpha = alphaEndpoints(5);
  const selectionSurfaceInactiveIntensity = intensityEndpoints(0);
  const selectionSurfaceInactiveTone = toneEndpoints(30);
  const selectionSurfaceInactiveAlpha = alphaEndpoints(25);
  // Extra signal-tone fields (omitted from roadmap tables)
  const borderSignalTone = toneEndpoints(50);
  const semanticSignalTone = toneEndpoints(50);
  const accentSubtleTone = toneEndpoints(30);
  const cautionSurfaceTone = toneEndpoints(30);
  // signalIntensityValue: new field for computeTones() — P6 is signal strength
  // Low = 0 (fully muted), high = 100 (fully vivid).
  // Reference value is 50 (neutral/default), so low=0, high=100.
  return {
    low: {
      onCautionTextIntensity: onCautionTextIntensity.low,
      onSuccessTextIntensity: onSuccessTextIntensity.low,
      badgeTintedTextIntensity: badgeTintedTextIntensity.low,
      badgeTintedTextTone: badgeTintedTextTone.low,
      badgeTintedSurfaceIntensity: badgeTintedSurfaceIntensity.low,
      badgeTintedSurfaceTone: badgeTintedSurfaceTone.low,
      badgeTintedSurfaceAlpha: badgeTintedSurfaceAlpha.low,
      badgeTintedBorderIntensity: badgeTintedBorderIntensity.low,
      badgeTintedBorderTone: badgeTintedBorderTone.low,
      badgeTintedBorderAlpha: badgeTintedBorderAlpha.low,
      iconActiveTone: iconActiveTone.low,
      iconMutedIntensity: iconMutedIntensity.low,
      iconMutedTone: iconMutedTone.low,
      tabTextActiveTone: tabTextActiveTone.low,
      toggleTrackOnHoverTone: toggleTrackOnHoverTone.low,
      toggleThumbDisabledTone: toggleThumbDisabledTone.low,
      toggleTrackDisabledIntensity: toggleTrackDisabledIntensity.low,
      ghostActionSurfaceHoverAlpha: ghostActionSurfaceHoverAlpha.low,
      ghostActionSurfaceActiveAlpha: ghostActionSurfaceActiveAlpha.low,
      ghostOptionSurfaceHoverAlpha: ghostOptionSurfaceHoverAlpha.low,
      ghostOptionSurfaceActiveAlpha: ghostOptionSurfaceActiveAlpha.low,
      ghostDangerSurfaceHoverAlpha: ghostDangerSurfaceHoverAlpha.low,
      ghostDangerSurfaceActiveAlpha: ghostDangerSurfaceActiveAlpha.low,
      tabSurfaceHoverAlpha: tabSurfaceHoverAlpha.low,
      tabCloseSurfaceHoverAlpha: tabCloseSurfaceHoverAlpha.low,
      highlightHoverAlpha: highlightHoverAlpha.low,
      selectionSurfaceInactiveIntensity: selectionSurfaceInactiveIntensity.low,
      selectionSurfaceInactiveTone: selectionSurfaceInactiveTone.low,
      selectionSurfaceInactiveAlpha: selectionSurfaceInactiveAlpha.low,
      borderSignalTone: borderSignalTone.low,
      semanticSignalTone: semanticSignalTone.low,
      accentSubtleTone: accentSubtleTone.low,
      cautionSurfaceTone: cautionSurfaceTone.low,
      signalIntensityValue: 0,
    },
    high: {
      onCautionTextIntensity: onCautionTextIntensity.high,
      onSuccessTextIntensity: onSuccessTextIntensity.high,
      badgeTintedTextIntensity: badgeTintedTextIntensity.high,
      badgeTintedTextTone: badgeTintedTextTone.high,
      badgeTintedSurfaceIntensity: badgeTintedSurfaceIntensity.high,
      badgeTintedSurfaceTone: badgeTintedSurfaceTone.high,
      badgeTintedSurfaceAlpha: badgeTintedSurfaceAlpha.high,
      badgeTintedBorderIntensity: badgeTintedBorderIntensity.high,
      badgeTintedBorderTone: badgeTintedBorderTone.high,
      badgeTintedBorderAlpha: badgeTintedBorderAlpha.high,
      iconActiveTone: iconActiveTone.high,
      iconMutedIntensity: iconMutedIntensity.high,
      iconMutedTone: iconMutedTone.high,
      tabTextActiveTone: tabTextActiveTone.high,
      toggleTrackOnHoverTone: toggleTrackOnHoverTone.high,
      toggleThumbDisabledTone: toggleThumbDisabledTone.high,
      toggleTrackDisabledIntensity: toggleTrackDisabledIntensity.high,
      ghostActionSurfaceHoverAlpha: ghostActionSurfaceHoverAlpha.high,
      ghostActionSurfaceActiveAlpha: ghostActionSurfaceActiveAlpha.high,
      ghostOptionSurfaceHoverAlpha: ghostOptionSurfaceHoverAlpha.high,
      ghostOptionSurfaceActiveAlpha: ghostOptionSurfaceActiveAlpha.high,
      ghostDangerSurfaceHoverAlpha: ghostDangerSurfaceHoverAlpha.high,
      ghostDangerSurfaceActiveAlpha: ghostDangerSurfaceActiveAlpha.high,
      tabSurfaceHoverAlpha: tabSurfaceHoverAlpha.high,
      tabCloseSurfaceHoverAlpha: tabCloseSurfaceHoverAlpha.high,
      highlightHoverAlpha: highlightHoverAlpha.high,
      selectionSurfaceInactiveIntensity: selectionSurfaceInactiveIntensity.high,
      selectionSurfaceInactiveTone: selectionSurfaceInactiveTone.high,
      selectionSurfaceInactiveAlpha: selectionSurfaceInactiveAlpha.high,
      borderSignalTone: borderSignalTone.high,
      semanticSignalTone: semanticSignalTone.high,
      accentSubtleTone: accentSubtleTone.high,
      cautionSurfaceTone: cautionSurfaceTone.high,
      signalIntensityValue: 100,
    },
  };
})();

/**
 * P7: Atmosphere — 13 fields (surface-coloring: atmosphereIntensity/surfaceAppIntensity/
 *     surfaceCanvasIntensity, text-coloring: atmosphereBorderIntensity,
 *     field-style, computed-tone-override: disabledSurfaceToneBase/Scale)
 */
const DARK_P7_ENDPOINTS: ParameterEndpoints = (() => {
  const atmosphereIntensity = intensityEndpoints(5);
  const surfaceAppIntensity = intensityEndpoints(2);
  const surfaceCanvasIntensity = intensityEndpoints(2);
  const atmosphereBorderIntensity = intensityEndpoints(6);
  const fieldSurfaceRestTone = toneEndpoints(8);
  const fieldSurfaceHoverTone = toneEndpoints(11);
  const fieldSurfaceFocusTone = toneEndpoints(7);
  const fieldSurfaceDisabledTone = toneEndpoints(6);
  const fieldSurfaceReadOnlyTone = toneEndpoints(11);
  const fieldSurfaceRestIntensity = intensityEndpoints(5);
  const disabledSurfaceIntensity = intensityEndpoints(5);
  const disabledSurfaceToneBase = toneEndpoints(22);
  return {
    low: {
      atmosphereIntensity: atmosphereIntensity.low,
      surfaceAppIntensity: surfaceAppIntensity.low,
      surfaceCanvasIntensity: surfaceCanvasIntensity.low,
      atmosphereBorderIntensity: atmosphereBorderIntensity.low,
      fieldSurfaceRestTone: fieldSurfaceRestTone.low,
      fieldSurfaceHoverTone: fieldSurfaceHoverTone.low,
      fieldSurfaceFocusTone: fieldSurfaceFocusTone.low,
      fieldSurfaceDisabledTone: fieldSurfaceDisabledTone.low,
      fieldSurfaceReadOnlyTone: fieldSurfaceReadOnlyTone.low,
      fieldSurfaceRestIntensity: fieldSurfaceRestIntensity.low,
      disabledSurfaceIntensity: disabledSurfaceIntensity.low,
      disabledSurfaceToneBase: disabledSurfaceToneBase.low,
      disabledSurfaceToneScale: 0,
    },
    high: {
      atmosphereIntensity: atmosphereIntensity.high,
      surfaceAppIntensity: surfaceAppIntensity.high,
      surfaceCanvasIntensity: surfaceCanvasIntensity.high,
      atmosphereBorderIntensity: atmosphereBorderIntensity.high,
      fieldSurfaceRestTone: fieldSurfaceRestTone.high,
      fieldSurfaceHoverTone: fieldSurfaceHoverTone.high,
      fieldSurfaceFocusTone: fieldSurfaceFocusTone.high,
      fieldSurfaceDisabledTone: fieldSurfaceDisabledTone.high,
      fieldSurfaceReadOnlyTone: fieldSurfaceReadOnlyTone.high,
      fieldSurfaceRestIntensity: fieldSurfaceRestIntensity.high,
      disabledSurfaceIntensity: disabledSurfaceIntensity.high,
      disabledSurfaceToneBase: disabledSurfaceToneBase.high,
      disabledSurfaceToneScale: 0,
    },
  };
})();

/**
 * All 7 endpoint pairs for dark mode. [D03]
 */
export const DARK_ENDPOINTS: ModeEndpoints = {
  surfaceDepth: DARK_P1_ENDPOINTS,
  textHierarchy: DARK_P2_ENDPOINTS,
  controlWeight: DARK_P3_ENDPOINTS,
  borderDefinition: DARK_P4_ENDPOINTS,
  shadowDepth: DARK_P5_ENDPOINTS,
  signalStrength: DARK_P6_ENDPOINTS,
  atmosphere: DARK_P7_ENDPOINTS,
};

// ---------------------------------------------------------------------------
// LIGHT_ENDPOINTS — 7 parameter endpoint pairs for light mode
// Reference values from LIGHT_FORMULAS.
// ---------------------------------------------------------------------------

const LIGHT_P1_ENDPOINTS: ParameterEndpoints = (() => {
  const surfaceAppTone = toneEndpoints(95);
  const surfaceCanvasTone = toneEndpoints(95);
  const surfaceSunkenTone = toneEndpoints(88);
  const surfaceDefaultTone = toneEndpoints(90);
  const surfaceRaisedTone = toneEndpoints(92);
  const surfaceOverlayTone = toneEndpoints(93);
  const surfaceInsetTone = toneEndpoints(86);
  const surfaceContentTone = toneEndpoints(86);
  const surfaceScreenTone = toneEndpoints(85);
  const surfaceDefaultIntensity = intensityEndpoints(6);
  const surfaceRaisedIntensity = intensityEndpoints(6);
  const surfaceOverlayIntensity = intensityEndpoints(5);
  const surfaceScreenIntensity = intensityEndpoints(8);
  const surfaceInsetIntensity = intensityEndpoints(6);
  const surfaceContentIntensity = intensityEndpoints(6);
  const surfaceAppBaseIntensity = intensityEndpoints(3);
  return {
    low: {
      surfaceAppTone: surfaceAppTone.low,
      surfaceCanvasTone: surfaceCanvasTone.low,
      surfaceSunkenTone: surfaceSunkenTone.low,
      surfaceDefaultTone: surfaceDefaultTone.low,
      surfaceRaisedTone: surfaceRaisedTone.low,
      surfaceOverlayTone: surfaceOverlayTone.low,
      surfaceInsetTone: surfaceInsetTone.low,
      surfaceContentTone: surfaceContentTone.low,
      surfaceScreenTone: surfaceScreenTone.low,
      surfaceDefaultIntensity: surfaceDefaultIntensity.low,
      surfaceRaisedIntensity: surfaceRaisedIntensity.low,
      surfaceOverlayIntensity: surfaceOverlayIntensity.low,
      surfaceScreenIntensity: surfaceScreenIntensity.low,
      surfaceInsetIntensity: surfaceInsetIntensity.low,
      surfaceContentIntensity: surfaceContentIntensity.low,
      surfaceAppBaseIntensity: surfaceAppBaseIntensity.low,
      surfaceCanvasToneBase: surfaceCanvasTone.low,
      surfaceCanvasToneCenter: 50,
      surfaceCanvasToneScale: 0,
    },
    high: {
      surfaceAppTone: surfaceAppTone.high,
      surfaceCanvasTone: surfaceCanvasTone.high,
      surfaceSunkenTone: surfaceSunkenTone.high,
      surfaceDefaultTone: surfaceDefaultTone.high,
      surfaceRaisedTone: surfaceRaisedTone.high,
      surfaceOverlayTone: surfaceOverlayTone.high,
      surfaceInsetTone: surfaceInsetTone.high,
      surfaceContentTone: surfaceContentTone.high,
      surfaceScreenTone: surfaceScreenTone.high,
      surfaceDefaultIntensity: surfaceDefaultIntensity.high,
      surfaceRaisedIntensity: surfaceRaisedIntensity.high,
      surfaceOverlayIntensity: surfaceOverlayIntensity.high,
      surfaceScreenIntensity: surfaceScreenIntensity.high,
      surfaceInsetIntensity: surfaceInsetIntensity.high,
      surfaceContentIntensity: surfaceContentIntensity.high,
      surfaceAppBaseIntensity: surfaceAppBaseIntensity.high,
      surfaceCanvasToneBase: surfaceCanvasTone.high,
      surfaceCanvasToneCenter: 50,
      surfaceCanvasToneScale: 0,
    },
  };
})();

const LIGHT_P2_ENDPOINTS: ParameterEndpoints = (() => {
  // Step 7 refinement: hierarchy tones use toneEndpointsWide() for the same
  // reason as dark mode — small-valued light tones (8–34) get too narrow a
  // visual range with ±50%.
  const contentTextTone = toneEndpointsWide(8); // low=0, high=16
  const inverseTextTone = toneEndpoints(94); // ceiling-anchored; already at max range
  const mutedTextTone = toneEndpointsWide(34); // low=0, high=68
  const subtleTextTone = toneEndpointsWide(52); // low=4, high=100 (ceiling-anchored)
  const disabledTextTone = toneEndpointsWide(68); // low=36, high=100
  const placeholderTextTone = toneEndpointsWide(60); // low=20, high=100
  const contentTextIntensity = intensityEndpoints(4);
  const subtleTextIntensity = intensityEndpoints(8);
  const mutedTextIntensity = intensityEndpoints(6);
  const inverseTextIntensity = intensityEndpoints(3);
  const disabledTextToneComputed = toneEndpointsWide(62); // low=24, high=100
  return {
    low: {
      contentTextTone: contentTextTone.low,
      inverseTextTone: inverseTextTone.low,
      mutedTextTone: mutedTextTone.low,
      subtleTextTone: subtleTextTone.low,
      disabledTextTone: disabledTextTone.low,
      placeholderTextTone: placeholderTextTone.low,
      contentTextIntensity: contentTextIntensity.low,
      subtleTextIntensity: subtleTextIntensity.low,
      mutedTextIntensity: mutedTextIntensity.low,
      inverseTextIntensity: inverseTextIntensity.low,
      disabledTextToneComputed: disabledTextToneComputed.low,
    },
    high: {
      contentTextTone: contentTextTone.high,
      inverseTextTone: inverseTextTone.high,
      mutedTextTone: mutedTextTone.high,
      subtleTextTone: subtleTextTone.high,
      disabledTextTone: disabledTextTone.high,
      placeholderTextTone: placeholderTextTone.high,
      contentTextIntensity: contentTextIntensity.high,
      subtleTextIntensity: subtleTextIntensity.high,
      mutedTextIntensity: mutedTextIntensity.high,
      inverseTextIntensity: inverseTextIntensity.high,
      disabledTextToneComputed: disabledTextToneComputed.high,
    },
  };
})();

const LIGHT_P3_ENDPOINTS: ParameterEndpoints = (() => {
  // Filled control — same wide range as dark mode so both modes sweep
  // consistently from near-invisible to bold at the parameter extremes.
  const filledSurfaceRestTone = toneEndpointsWide(20); // low=0, high=40
  const filledSurfaceHoverTone = toneEndpointsWide(40); // low=0, high=80
  const filledSurfaceActiveTone = toneEndpoints(50); // low=25, high=75 (symmetric)
  // Outlined control (light mode: near-dark tones, ref from LIGHT_FORMULAS)
  const outlinedTextRestTone = toneEndpoints(8);
  const outlinedTextHoverTone = toneEndpoints(8);
  const outlinedTextActiveTone = toneEndpoints(8);
  const outlinedTextIntensity = intensityEndpoints(4);
  const outlinedIconRestTone = toneEndpoints(8);
  const outlinedIconHoverTone = toneEndpoints(8);
  const outlinedIconActiveTone = toneEndpoints(8);
  const outlinedIconIntensity = intensityEndpoints(4);
  const outlinedSurfaceHoverIntensity = intensityEndpoints(4);
  const outlinedSurfaceHoverAlpha = alphaEndpoints(100);
  const outlinedSurfaceActiveIntensity = intensityEndpoints(6);
  const outlinedSurfaceActiveAlpha = alphaEndpoints(100);
  const outlinedOptionBorderRestTone = toneEndpoints(50);
  const outlinedOptionBorderHoverTone = toneEndpoints(55);
  const outlinedOptionBorderActiveTone = toneEndpoints(60);
  // Light-mode outlined tone counterparts (mode-independent: pure black = 0)
  const outlinedTextRestToneLight = toneEndpoints(0);
  const outlinedTextHoverToneLight = toneEndpoints(0);
  const outlinedTextActiveToneLight = toneEndpoints(0);
  const outlinedIconRestToneLight = toneEndpoints(0);
  const outlinedIconHoverToneLight = toneEndpoints(0);
  const outlinedIconActiveToneLight = toneEndpoints(0);
  // Ghost control (light mode: near-dark tones)
  const ghostTextRestTone = toneEndpoints(8);
  const ghostTextHoverTone = toneEndpoints(8);
  const ghostTextActiveTone = toneEndpoints(8);
  const ghostTextRestIntensity = intensityEndpoints(4);
  const ghostTextHoverIntensity = intensityEndpoints(4);
  const ghostTextActiveIntensity = intensityEndpoints(4);
  const ghostIconRestTone = toneEndpoints(8);
  const ghostIconHoverTone = toneEndpoints(8);
  const ghostIconActiveTone = toneEndpoints(8);
  const ghostIconRestIntensity = intensityEndpoints(4);
  const ghostIconHoverIntensity = intensityEndpoints(4);
  const ghostIconActiveIntensity = intensityEndpoints(4);
  const ghostBorderIntensity = intensityEndpoints(20);
  const ghostBorderTone = toneEndpoints(35);
  // Light-mode ghost tone/intensity counterparts (mode-independent: pure black)
  const ghostTextRestToneLight = toneEndpoints(0);
  const ghostTextHoverToneLight = toneEndpoints(0);
  const ghostTextActiveToneLight = toneEndpoints(0);
  const ghostTextRestIntensityLight = intensityEndpoints(0);
  const ghostTextHoverIntensityLight = intensityEndpoints(0);
  const ghostTextActiveIntensityLight = intensityEndpoints(0);
  const ghostIconRestToneLight = toneEndpoints(0);
  const ghostIconHoverToneLight = toneEndpoints(0);
  const ghostIconActiveToneLight = toneEndpoints(0);
  const ghostIconActiveIntensityLight = intensityEndpoints(0);
  return {
    low: {
      filledSurfaceRestTone: filledSurfaceRestTone.low,
      filledSurfaceHoverTone: filledSurfaceHoverTone.low,
      filledSurfaceActiveTone: filledSurfaceActiveTone.low,
      outlinedTextRestTone: outlinedTextRestTone.low,
      outlinedTextHoverTone: outlinedTextHoverTone.low,
      outlinedTextActiveTone: outlinedTextActiveTone.low,
      outlinedTextIntensity: outlinedTextIntensity.low,
      outlinedIconRestTone: outlinedIconRestTone.low,
      outlinedIconHoverTone: outlinedIconHoverTone.low,
      outlinedIconActiveTone: outlinedIconActiveTone.low,
      outlinedIconIntensity: outlinedIconIntensity.low,
      outlinedSurfaceHoverIntensity: outlinedSurfaceHoverIntensity.low,
      outlinedSurfaceHoverAlpha: outlinedSurfaceHoverAlpha.low,
      outlinedSurfaceActiveIntensity: outlinedSurfaceActiveIntensity.low,
      outlinedSurfaceActiveAlpha: outlinedSurfaceActiveAlpha.low,
      outlinedOptionBorderRestTone: outlinedOptionBorderRestTone.low,
      outlinedOptionBorderHoverTone: outlinedOptionBorderHoverTone.low,
      outlinedOptionBorderActiveTone: outlinedOptionBorderActiveTone.low,
      outlinedTextRestToneLight: outlinedTextRestToneLight.low,
      outlinedTextHoverToneLight: outlinedTextHoverToneLight.low,
      outlinedTextActiveToneLight: outlinedTextActiveToneLight.low,
      outlinedIconRestToneLight: outlinedIconRestToneLight.low,
      outlinedIconHoverToneLight: outlinedIconHoverToneLight.low,
      outlinedIconActiveToneLight: outlinedIconActiveToneLight.low,
      ghostTextRestTone: ghostTextRestTone.low,
      ghostTextHoverTone: ghostTextHoverTone.low,
      ghostTextActiveTone: ghostTextActiveTone.low,
      ghostTextRestIntensity: ghostTextRestIntensity.low,
      ghostTextHoverIntensity: ghostTextHoverIntensity.low,
      ghostTextActiveIntensity: ghostTextActiveIntensity.low,
      ghostIconRestTone: ghostIconRestTone.low,
      ghostIconHoverTone: ghostIconHoverTone.low,
      ghostIconActiveTone: ghostIconActiveTone.low,
      ghostIconRestIntensity: ghostIconRestIntensity.low,
      ghostIconHoverIntensity: ghostIconHoverIntensity.low,
      ghostIconActiveIntensity: ghostIconActiveIntensity.low,
      ghostBorderIntensity: ghostBorderIntensity.low,
      ghostBorderTone: ghostBorderTone.low,
      ghostTextRestToneLight: ghostTextRestToneLight.low,
      ghostTextHoverToneLight: ghostTextHoverToneLight.low,
      ghostTextActiveToneLight: ghostTextActiveToneLight.low,
      ghostTextRestIntensityLight: ghostTextRestIntensityLight.low,
      ghostTextHoverIntensityLight: ghostTextHoverIntensityLight.low,
      ghostTextActiveIntensityLight: ghostTextActiveIntensityLight.low,
      ghostIconRestToneLight: ghostIconRestToneLight.low,
      ghostIconHoverToneLight: ghostIconHoverToneLight.low,
      ghostIconActiveToneLight: ghostIconActiveToneLight.low,
      ghostIconActiveIntensityLight: ghostIconActiveIntensityLight.low,
    },
    high: {
      filledSurfaceRestTone: filledSurfaceRestTone.high,
      filledSurfaceHoverTone: filledSurfaceHoverTone.high,
      filledSurfaceActiveTone: filledSurfaceActiveTone.high,
      outlinedTextRestTone: outlinedTextRestTone.high,
      outlinedTextHoverTone: outlinedTextHoverTone.high,
      outlinedTextActiveTone: outlinedTextActiveTone.high,
      outlinedTextIntensity: outlinedTextIntensity.high,
      outlinedIconRestTone: outlinedIconRestTone.high,
      outlinedIconHoverTone: outlinedIconHoverTone.high,
      outlinedIconActiveTone: outlinedIconActiveTone.high,
      outlinedIconIntensity: outlinedIconIntensity.high,
      outlinedSurfaceHoverIntensity: outlinedSurfaceHoverIntensity.high,
      outlinedSurfaceHoverAlpha: outlinedSurfaceHoverAlpha.high,
      outlinedSurfaceActiveIntensity: outlinedSurfaceActiveIntensity.high,
      outlinedSurfaceActiveAlpha: outlinedSurfaceActiveAlpha.high,
      outlinedOptionBorderRestTone: outlinedOptionBorderRestTone.high,
      outlinedOptionBorderHoverTone: outlinedOptionBorderHoverTone.high,
      outlinedOptionBorderActiveTone: outlinedOptionBorderActiveTone.high,
      outlinedTextRestToneLight: outlinedTextRestToneLight.high,
      outlinedTextHoverToneLight: outlinedTextHoverToneLight.high,
      outlinedTextActiveToneLight: outlinedTextActiveToneLight.high,
      outlinedIconRestToneLight: outlinedIconRestToneLight.high,
      outlinedIconHoverToneLight: outlinedIconHoverToneLight.high,
      outlinedIconActiveToneLight: outlinedIconActiveToneLight.high,
      ghostTextRestTone: ghostTextRestTone.high,
      ghostTextHoverTone: ghostTextHoverTone.high,
      ghostTextActiveTone: ghostTextActiveTone.high,
      ghostTextRestIntensity: ghostTextRestIntensity.high,
      ghostTextHoverIntensity: ghostTextHoverIntensity.high,
      ghostTextActiveIntensity: ghostTextActiveIntensity.high,
      ghostIconRestTone: ghostIconRestTone.high,
      ghostIconHoverTone: ghostIconHoverTone.high,
      ghostIconActiveTone: ghostIconActiveTone.high,
      ghostIconRestIntensity: ghostIconRestIntensity.high,
      ghostIconHoverIntensity: ghostIconHoverIntensity.high,
      ghostIconActiveIntensity: ghostIconActiveIntensity.high,
      ghostBorderIntensity: ghostBorderIntensity.high,
      ghostBorderTone: ghostBorderTone.high,
      ghostTextRestToneLight: ghostTextRestToneLight.high,
      ghostTextHoverToneLight: ghostTextHoverToneLight.high,
      ghostTextActiveToneLight: ghostTextActiveToneLight.high,
      ghostTextRestIntensityLight: ghostTextRestIntensityLight.high,
      ghostTextHoverIntensityLight: ghostTextHoverIntensityLight.high,
      ghostTextActiveIntensityLight: ghostTextActiveIntensityLight.high,
      ghostIconRestToneLight: ghostIconRestToneLight.high,
      ghostIconHoverToneLight: ghostIconHoverToneLight.high,
      ghostIconActiveToneLight: ghostIconActiveToneLight.high,
      ghostIconActiveIntensityLight: ghostIconActiveIntensityLight.high,
    },
  };
})();

const LIGHT_P4_ENDPOINTS: ParameterEndpoints = (() => {
  const borderBaseIntensity = intensityEndpoints(8);
  const borderStrongIntensity = intensityEndpoints(10);
  const borderMutedTone = toneEndpoints(62);
  const borderMutedIntensity = intensityEndpoints(8);
  const borderStrongTone = toneEndpoints(52);
  const dividerDefaultIntensity = intensityEndpoints(7);
  const dividerMutedIntensity = intensityEndpoints(5);
  const cardFrameActiveIntensity = intensityEndpoints(12);
  const cardFrameActiveTone = toneEndpoints(96);
  const cardFrameInactiveIntensity = intensityEndpoints(5);
  const cardFrameInactiveTone = toneEndpoints(93);
  const borderStrongToneComputed = toneEndpoints(40);
  const dividerDefaultToneOverride = toneEndpoints(78);
  const dividerMutedToneOverride = toneEndpoints(82);
  const disabledBorderIntensity = intensityEndpoints(6);
  const disabledBorderToneOverride = toneEndpoints(72);
  return {
    low: {
      borderBaseIntensity: borderBaseIntensity.low,
      borderStrongIntensity: borderStrongIntensity.low,
      borderMutedTone: borderMutedTone.low,
      borderMutedIntensity: borderMutedIntensity.low,
      borderStrongTone: borderStrongTone.low,
      dividerDefaultIntensity: dividerDefaultIntensity.low,
      dividerMutedIntensity: dividerMutedIntensity.low,
      cardFrameActiveIntensity: cardFrameActiveIntensity.low,
      cardFrameActiveTone: cardFrameActiveTone.low,
      cardFrameInactiveIntensity: cardFrameInactiveIntensity.low,
      cardFrameInactiveTone: cardFrameInactiveTone.low,
      borderStrongToneComputed: borderStrongToneComputed.low,
      dividerDefaultToneOverride: dividerDefaultToneOverride.low,
      dividerMutedToneOverride: dividerMutedToneOverride.low,
      disabledBorderIntensity: disabledBorderIntensity.low,
      disabledBorderToneOverride: disabledBorderToneOverride.low,
    },
    high: {
      borderBaseIntensity: borderBaseIntensity.high,
      borderStrongIntensity: borderStrongIntensity.high,
      borderMutedTone: borderMutedTone.high,
      borderMutedIntensity: borderMutedIntensity.high,
      borderStrongTone: borderStrongTone.high,
      dividerDefaultIntensity: dividerDefaultIntensity.high,
      dividerMutedIntensity: dividerMutedIntensity.high,
      cardFrameActiveIntensity: cardFrameActiveIntensity.high,
      cardFrameActiveTone: cardFrameActiveTone.high,
      cardFrameInactiveIntensity: cardFrameInactiveIntensity.high,
      cardFrameInactiveTone: cardFrameInactiveTone.high,
      borderStrongToneComputed: borderStrongToneComputed.high,
      dividerDefaultToneOverride: dividerDefaultToneOverride.high,
      dividerMutedToneOverride: dividerMutedToneOverride.high,
      disabledBorderIntensity: disabledBorderIntensity.high,
      disabledBorderToneOverride: disabledBorderToneOverride.high,
    },
  };
})();

const LIGHT_P5_ENDPOINTS: ParameterEndpoints = (() => {
  const shadowXsAlpha = alphaEndpoints(10);
  const shadowMdAlpha = alphaEndpoints(25);
  const shadowLgAlpha = alphaEndpoints(35);
  const shadowXlAlpha = alphaEndpoints(40);
  const shadowOverlayAlpha = alphaEndpoints(30);
  const overlayDimAlpha = alphaEndpoints(32);
  const overlayScrimAlpha = alphaEndpoints(48);
  const overlayHighlightAlpha = alphaEndpoints(4);
  return {
    low: {
      shadowXsAlpha: shadowXsAlpha.low,
      shadowMdAlpha: shadowMdAlpha.low,
      shadowLgAlpha: shadowLgAlpha.low,
      shadowXlAlpha: shadowXlAlpha.low,
      shadowOverlayAlpha: shadowOverlayAlpha.low,
      overlayDimAlpha: overlayDimAlpha.low,
      overlayScrimAlpha: overlayScrimAlpha.low,
      overlayHighlightAlpha: overlayHighlightAlpha.low,
    },
    high: {
      shadowXsAlpha: shadowXsAlpha.high,
      shadowMdAlpha: shadowMdAlpha.high,
      shadowLgAlpha: shadowLgAlpha.high,
      shadowXlAlpha: shadowXlAlpha.high,
      shadowOverlayAlpha: shadowOverlayAlpha.high,
      overlayDimAlpha: overlayDimAlpha.high,
      overlayScrimAlpha: overlayScrimAlpha.high,
      overlayHighlightAlpha: overlayHighlightAlpha.high,
    },
  };
})();

const LIGHT_P6_ENDPOINTS: ParameterEndpoints = (() => {
  const onCautionTextIntensity = intensityEndpoints(5);
  const onSuccessTextIntensity = intensityEndpoints(5);
  const badgeTintedTextIntensity = intensityEndpoints(72);
  const badgeTintedTextTone = toneEndpoints(15);
  const badgeTintedSurfaceIntensity = intensityEndpoints(65);
  const badgeTintedSurfaceTone = toneEndpoints(80);
  const badgeTintedSurfaceAlpha = alphaEndpoints(20);
  const badgeTintedBorderIntensity = intensityEndpoints(50);
  const badgeTintedBorderTone = toneEndpoints(40);
  const badgeTintedBorderAlpha = alphaEndpoints(40);
  const iconActiveTone = toneEndpoints(20);
  const iconMutedIntensity = intensityEndpoints(7);
  const iconMutedTone = toneEndpoints(52);
  const tabTextActiveTone = toneEndpoints(10);
  const toggleTrackOnHoverTone = toneEndpoints(35);
  const toggleThumbDisabledTone = toneEndpoints(65);
  const toggleTrackDisabledIntensity = intensityEndpoints(5);
  // Sentinel alphas (mode-independent — same as dark)
  const ghostActionSurfaceHoverAlpha = alphaEndpoints(10);
  const ghostActionSurfaceActiveAlpha = alphaEndpoints(20);
  const ghostOptionSurfaceHoverAlpha = alphaEndpoints(10);
  const ghostOptionSurfaceActiveAlpha = alphaEndpoints(20);
  const ghostDangerSurfaceHoverAlpha = alphaEndpoints(10);
  const ghostDangerSurfaceActiveAlpha = alphaEndpoints(20);
  const tabSurfaceHoverAlpha = alphaEndpoints(8);
  const tabCloseSurfaceHoverAlpha = alphaEndpoints(12);
  const highlightHoverAlpha = alphaEndpoints(5);
  const selectionSurfaceInactiveIntensity = intensityEndpoints(8);
  const selectionSurfaceInactiveTone = toneEndpoints(80);
  const selectionSurfaceInactiveAlpha = alphaEndpoints(30);
  // Extra signal-tone fields
  const borderSignalTone = toneEndpoints(40);
  const semanticSignalTone = toneEndpoints(35);
  const accentSubtleTone = toneEndpoints(50);
  const cautionSurfaceTone = toneEndpoints(35);
  return {
    low: {
      onCautionTextIntensity: onCautionTextIntensity.low,
      onSuccessTextIntensity: onSuccessTextIntensity.low,
      badgeTintedTextIntensity: badgeTintedTextIntensity.low,
      badgeTintedTextTone: badgeTintedTextTone.low,
      badgeTintedSurfaceIntensity: badgeTintedSurfaceIntensity.low,
      badgeTintedSurfaceTone: badgeTintedSurfaceTone.low,
      badgeTintedSurfaceAlpha: badgeTintedSurfaceAlpha.low,
      badgeTintedBorderIntensity: badgeTintedBorderIntensity.low,
      badgeTintedBorderTone: badgeTintedBorderTone.low,
      badgeTintedBorderAlpha: badgeTintedBorderAlpha.low,
      iconActiveTone: iconActiveTone.low,
      iconMutedIntensity: iconMutedIntensity.low,
      iconMutedTone: iconMutedTone.low,
      tabTextActiveTone: tabTextActiveTone.low,
      toggleTrackOnHoverTone: toggleTrackOnHoverTone.low,
      toggleThumbDisabledTone: toggleThumbDisabledTone.low,
      toggleTrackDisabledIntensity: toggleTrackDisabledIntensity.low,
      ghostActionSurfaceHoverAlpha: ghostActionSurfaceHoverAlpha.low,
      ghostActionSurfaceActiveAlpha: ghostActionSurfaceActiveAlpha.low,
      ghostOptionSurfaceHoverAlpha: ghostOptionSurfaceHoverAlpha.low,
      ghostOptionSurfaceActiveAlpha: ghostOptionSurfaceActiveAlpha.low,
      ghostDangerSurfaceHoverAlpha: ghostDangerSurfaceHoverAlpha.low,
      ghostDangerSurfaceActiveAlpha: ghostDangerSurfaceActiveAlpha.low,
      tabSurfaceHoverAlpha: tabSurfaceHoverAlpha.low,
      tabCloseSurfaceHoverAlpha: tabCloseSurfaceHoverAlpha.low,
      highlightHoverAlpha: highlightHoverAlpha.low,
      selectionSurfaceInactiveIntensity: selectionSurfaceInactiveIntensity.low,
      selectionSurfaceInactiveTone: selectionSurfaceInactiveTone.low,
      selectionSurfaceInactiveAlpha: selectionSurfaceInactiveAlpha.low,
      borderSignalTone: borderSignalTone.low,
      semanticSignalTone: semanticSignalTone.low,
      accentSubtleTone: accentSubtleTone.low,
      cautionSurfaceTone: cautionSurfaceTone.low,
      signalIntensityValue: 0,
    },
    high: {
      onCautionTextIntensity: onCautionTextIntensity.high,
      onSuccessTextIntensity: onSuccessTextIntensity.high,
      badgeTintedTextIntensity: badgeTintedTextIntensity.high,
      badgeTintedTextTone: badgeTintedTextTone.high,
      badgeTintedSurfaceIntensity: badgeTintedSurfaceIntensity.high,
      badgeTintedSurfaceTone: badgeTintedSurfaceTone.high,
      badgeTintedSurfaceAlpha: badgeTintedSurfaceAlpha.high,
      badgeTintedBorderIntensity: badgeTintedBorderIntensity.high,
      badgeTintedBorderTone: badgeTintedBorderTone.high,
      badgeTintedBorderAlpha: badgeTintedBorderAlpha.high,
      iconActiveTone: iconActiveTone.high,
      iconMutedIntensity: iconMutedIntensity.high,
      iconMutedTone: iconMutedTone.high,
      tabTextActiveTone: tabTextActiveTone.high,
      toggleTrackOnHoverTone: toggleTrackOnHoverTone.high,
      toggleThumbDisabledTone: toggleThumbDisabledTone.high,
      toggleTrackDisabledIntensity: toggleTrackDisabledIntensity.high,
      ghostActionSurfaceHoverAlpha: ghostActionSurfaceHoverAlpha.high,
      ghostActionSurfaceActiveAlpha: ghostActionSurfaceActiveAlpha.high,
      ghostOptionSurfaceHoverAlpha: ghostOptionSurfaceHoverAlpha.high,
      ghostOptionSurfaceActiveAlpha: ghostOptionSurfaceActiveAlpha.high,
      ghostDangerSurfaceHoverAlpha: ghostDangerSurfaceHoverAlpha.high,
      ghostDangerSurfaceActiveAlpha: ghostDangerSurfaceActiveAlpha.high,
      tabSurfaceHoverAlpha: tabSurfaceHoverAlpha.high,
      tabCloseSurfaceHoverAlpha: tabCloseSurfaceHoverAlpha.high,
      highlightHoverAlpha: highlightHoverAlpha.high,
      selectionSurfaceInactiveIntensity: selectionSurfaceInactiveIntensity.high,
      selectionSurfaceInactiveTone: selectionSurfaceInactiveTone.high,
      selectionSurfaceInactiveAlpha: selectionSurfaceInactiveAlpha.high,
      borderSignalTone: borderSignalTone.high,
      semanticSignalTone: semanticSignalTone.high,
      accentSubtleTone: accentSubtleTone.high,
      cautionSurfaceTone: cautionSurfaceTone.high,
      signalIntensityValue: 100,
    },
  };
})();

const LIGHT_P7_ENDPOINTS: ParameterEndpoints = (() => {
  const atmosphereIntensity = intensityEndpoints(6);
  const surfaceAppIntensity = intensityEndpoints(3);
  const surfaceCanvasIntensity = intensityEndpoints(3);
  const atmosphereBorderIntensity = intensityEndpoints(7);
  const fieldSurfaceRestTone = toneEndpoints(91);
  const fieldSurfaceHoverTone = toneEndpoints(88);
  const fieldSurfaceFocusTone = toneEndpoints(92);
  const fieldSurfaceDisabledTone = toneEndpoints(94);
  const fieldSurfaceReadOnlyTone = toneEndpoints(88);
  const fieldSurfaceRestIntensity = intensityEndpoints(5);
  const disabledSurfaceIntensity = intensityEndpoints(4);
  const disabledSurfaceToneBase = toneEndpoints(78);
  return {
    low: {
      atmosphereIntensity: atmosphereIntensity.low,
      surfaceAppIntensity: surfaceAppIntensity.low,
      surfaceCanvasIntensity: surfaceCanvasIntensity.low,
      atmosphereBorderIntensity: atmosphereBorderIntensity.low,
      fieldSurfaceRestTone: fieldSurfaceRestTone.low,
      fieldSurfaceHoverTone: fieldSurfaceHoverTone.low,
      fieldSurfaceFocusTone: fieldSurfaceFocusTone.low,
      fieldSurfaceDisabledTone: fieldSurfaceDisabledTone.low,
      fieldSurfaceReadOnlyTone: fieldSurfaceReadOnlyTone.low,
      fieldSurfaceRestIntensity: fieldSurfaceRestIntensity.low,
      disabledSurfaceIntensity: disabledSurfaceIntensity.low,
      disabledSurfaceToneBase: disabledSurfaceToneBase.low,
      disabledSurfaceToneScale: 0,
    },
    high: {
      atmosphereIntensity: atmosphereIntensity.high,
      surfaceAppIntensity: surfaceAppIntensity.high,
      surfaceCanvasIntensity: surfaceCanvasIntensity.high,
      atmosphereBorderIntensity: atmosphereBorderIntensity.high,
      fieldSurfaceRestTone: fieldSurfaceRestTone.high,
      fieldSurfaceHoverTone: fieldSurfaceHoverTone.high,
      fieldSurfaceFocusTone: fieldSurfaceFocusTone.high,
      fieldSurfaceDisabledTone: fieldSurfaceDisabledTone.high,
      fieldSurfaceReadOnlyTone: fieldSurfaceReadOnlyTone.high,
      fieldSurfaceRestIntensity: fieldSurfaceRestIntensity.high,
      disabledSurfaceIntensity: disabledSurfaceIntensity.high,
      disabledSurfaceToneBase: disabledSurfaceToneBase.high,
      disabledSurfaceToneScale: 0,
    },
  };
})();

/**
 * All 7 endpoint pairs for light mode. [D03]
 */
export const LIGHT_ENDPOINTS: ModeEndpoints = {
  surfaceDepth: LIGHT_P1_ENDPOINTS,
  textHierarchy: LIGHT_P2_ENDPOINTS,
  controlWeight: LIGHT_P3_ENDPOINTS,
  borderDefinition: LIGHT_P4_ENDPOINTS,
  shadowDepth: LIGHT_P5_ENDPOINTS,
  signalStrength: LIGHT_P6_ENDPOINTS,
  atmosphere: LIGHT_P7_ENDPOINTS,
};

// ---------------------------------------------------------------------------
// compileRecipe — Spec S03
// ---------------------------------------------------------------------------

/**
 * Compile a RecipeParameters object into a complete DerivationFormulas.
 *
 * Steps (per Spec S03):
 *   1. Select mode template (DARK_STRUCTURAL_TEMPLATE or LIGHT_STRUCTURAL_TEMPLATE).
 *   2. Start with template (structural/routing fields).
 *   3. For each parameter P1-P7, select mode-specific endpoint pair.
 *   4. For each field, interpolate: value = low + (V / 100) * (high - low).
 *   5. Clamp numeric results: tones to [0, 100], intensities to [0, 100],
 *      alphas to [0, 100].
 *   6. Overlay interpolated fields onto the template.
 *   7. Set surfaceCanvasToneScale: 0, surfaceCanvasToneCenter: 50,
 *      disabledSurfaceToneScale: 0 to neutralize computeTones() scaling. [D04]
 *      Set signalIntensityValue from P6 interpolation.
 *   8. Return the complete DerivationFormulas.
 *
 * @param mode       - "dark" or "light"
 * @param parameters - RecipeParameters (7 values 0-100)
 * @returns Complete DerivationFormulas (all fields populated)
 */
/**
 * Returns the sorted list of field names controlled by a given parameter key
 * in a given mode.
 *
 * Field names are derived from the keys of the corresponding endpoint bundle's
 * `low` map (low and high maps always have identical keys).
 *
 * @param paramKey - One of the 7 RecipeParameters keys
 * @param mode     - "dark" or "light"
 * @returns Sorted array of field name strings
 */
export function getParameterFields(
  paramKey: keyof RecipeParameters,
  mode: "dark" | "light",
): string[] {
  const endpoints = mode === "dark" ? DARK_ENDPOINTS : LIGHT_ENDPOINTS;
  return Object.keys(endpoints[paramKey].low).sort();
}

export function compileRecipe(
  mode: "dark" | "light",
  parameters: RecipeParameters,
): DerivationFormulas {
  const template = mode === "dark" ? DARK_STRUCTURAL_TEMPLATE : LIGHT_STRUCTURAL_TEMPLATE;
  const modeEndpoints = mode === "dark" ? DARK_ENDPOINTS : LIGHT_ENDPOINTS;

  // Start with template (structural/routing fields).
  const result: Record<string, number | string | boolean | null> = { ...template };

  // For each parameter, interpolate its controlled fields.
  for (const [paramKey, paramValue] of Object.entries(parameters) as [
    keyof RecipeParameters,
    number,
  ][]) {
    const endpoints = modeEndpoints[paramKey];
    const v = Math.max(0, Math.min(100, paramValue)); // clamp input to [0, 100]
    const t = v / 100; // interpolation factor [0, 1]

    for (const [field, lowValue] of Object.entries(endpoints.low)) {
      const highValue = endpoints.high[field];
      const interpolated = lowValue + t * (highValue - lowValue);
      // Clamp to [0, 100] (applies to tones, intensities, and alphas uniformly).
      result[field] = Math.max(0, Math.min(100, interpolated));
    }
  }

  // Ensure neutralization overrides are set per [D04]:
  //   surfaceCanvasToneScale = 0 — eliminates surfaceContrast scaling in computeTones()
  //   surfaceCanvasToneCenter = 50 — midpoint; with scale=0 this is irrelevant but
  //                                  must be set to satisfy the formula structure
  //   disabledSurfaceToneScale = 0 — already set in P7 endpoints, but enforce here
  result["surfaceCanvasToneScale"] = 0;
  result["surfaceCanvasToneCenter"] = 50;
  result["disabledSurfaceToneScale"] = 0;

  return result as unknown as DerivationFormulas;
}
