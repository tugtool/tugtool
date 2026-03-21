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

import { DARK_FORMULAS, LIGHT_FORMULAS } from "./formula-constants";
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
  const surfaceAppTone = toneEndpointsWide(DARK_FORMULAS.surfaceAppTone);
  const surfaceCanvasTone = toneEndpointsWide(DARK_FORMULAS.surfaceCanvasTone);
  const surfaceSunkenTone = toneEndpointsWide(DARK_FORMULAS.surfaceSunkenTone);
  const surfaceDefaultTone = toneEndpointsWide(DARK_FORMULAS.surfaceDefaultTone);
  const surfaceRaisedTone = toneEndpointsWide(DARK_FORMULAS.surfaceRaisedTone);
  const surfaceOverlayTone = toneEndpointsWide(DARK_FORMULAS.surfaceOverlayTone);
  const surfaceInsetTone = toneEndpointsWide(DARK_FORMULAS.surfaceInsetTone);
  const surfaceContentTone = toneEndpointsWide(DARK_FORMULAS.surfaceContentTone);
  const surfaceScreenTone = toneEndpointsWide(DARK_FORMULAS.surfaceScreenTone);
  // Intensity fields — wide range for same reason as tone fields
  const surfaceDefaultIntensity = intensityEndpointsWide(DARK_FORMULAS.surfaceDefaultIntensity);
  const surfaceRaisedIntensity = intensityEndpointsWide(DARK_FORMULAS.surfaceRaisedIntensity);
  const surfaceOverlayIntensity = intensityEndpointsWide(DARK_FORMULAS.surfaceOverlayIntensity);
  const surfaceScreenIntensity = intensityEndpointsWide(DARK_FORMULAS.surfaceScreenIntensity);
  const surfaceInsetIntensity = intensityEndpointsWide(DARK_FORMULAS.surfaceInsetIntensity);
  const surfaceContentIntensity = intensityEndpointsWide(DARK_FORMULAS.surfaceContentIntensity);
  const surfaceAppBaseIntensity = intensityEndpointsWide(DARK_FORMULAS.surfaceAppBaseIntensity);
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
  const contentTextTone = toneEndpoints(DARK_FORMULAS.contentTextTone); // ceiling-anchored; already at max range
  const inverseTextTone = toneEndpoints(DARK_FORMULAS.inverseTextTone); // fixed at 100 in both modes
  const mutedTextTone = toneEndpointsWide(DARK_FORMULAS.mutedTextTone); // low=32, high=100 (wider than 33/99)
  const subtleTextTone = toneEndpointsWide(DARK_FORMULAS.subtleTextTone); // low=0, high=74
  const disabledTextTone = toneEndpointsWide(DARK_FORMULAS.disabledTextTone); // low=0, high=46
  const placeholderTextTone = toneEndpointsWide(DARK_FORMULAS.placeholderTextTone); // low=0, high=60
  const contentTextIntensity = intensityEndpoints(DARK_FORMULAS.contentTextIntensity);
  const subtleTextIntensity = intensityEndpoints(DARK_FORMULAS.subtleTextIntensity);
  const mutedTextIntensity = intensityEndpoints(DARK_FORMULAS.mutedTextIntensity);
  const inverseTextIntensity = intensityEndpoints(DARK_FORMULAS.inverseTextIntensity);
  const disabledTextToneComputed = toneEndpointsWide(DARK_FORMULAS.disabledTextToneComputed); // low=0, high=76
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
  const filledSurfaceRestTone = toneEndpointsWide(DARK_FORMULAS.filledSurfaceRestTone); // low=0, high=40
  const filledSurfaceHoverTone = toneEndpointsWide(DARK_FORMULAS.filledSurfaceHoverTone); // low=0, high=80
  const filledSurfaceActiveTone = toneEndpoints(DARK_FORMULAS.filledSurfaceActiveTone); // low=25, high=75 (symmetric at midpoint)
  // Outlined control
  const outlinedTextRestTone = toneEndpoints(DARK_FORMULAS.outlinedTextRestTone);
  const outlinedTextHoverTone = toneEndpoints(DARK_FORMULAS.outlinedTextHoverTone);
  const outlinedTextActiveTone = toneEndpoints(DARK_FORMULAS.outlinedTextActiveTone);
  const outlinedTextIntensity = intensityEndpoints(DARK_FORMULAS.outlinedTextIntensity);
  const outlinedIconRestTone = toneEndpoints(DARK_FORMULAS.outlinedIconRestTone);
  const outlinedIconHoverTone = toneEndpoints(DARK_FORMULAS.outlinedIconHoverTone);
  const outlinedIconActiveTone = toneEndpoints(DARK_FORMULAS.outlinedIconActiveTone);
  const outlinedIconIntensity = intensityEndpoints(DARK_FORMULAS.outlinedIconIntensity);
  const outlinedSurfaceHoverIntensity = intensityEndpoints(DARK_FORMULAS.outlinedSurfaceHoverIntensity);
  const outlinedSurfaceHoverAlpha = alphaEndpoints(DARK_FORMULAS.outlinedSurfaceHoverAlpha);
  const outlinedSurfaceActiveIntensity = intensityEndpoints(DARK_FORMULAS.outlinedSurfaceActiveIntensity);
  const outlinedSurfaceActiveAlpha = alphaEndpoints(DARK_FORMULAS.outlinedSurfaceActiveAlpha);
  const outlinedOptionBorderRestTone = toneEndpoints(DARK_FORMULAS.outlinedOptionBorderRestTone);
  const outlinedOptionBorderHoverTone = toneEndpoints(DARK_FORMULAS.outlinedOptionBorderHoverTone);
  const outlinedOptionBorderActiveTone = toneEndpoints(DARK_FORMULAS.outlinedOptionBorderActiveTone);
  // Light-mode outlined tone counterparts (dark mode: 0 = pure black)
  const outlinedTextRestToneLight = toneEndpoints(DARK_FORMULAS.outlinedTextRestToneLight);
  const outlinedTextHoverToneLight = toneEndpoints(DARK_FORMULAS.outlinedTextHoverToneLight);
  const outlinedTextActiveToneLight = toneEndpoints(DARK_FORMULAS.outlinedTextActiveToneLight);
  const outlinedIconRestToneLight = toneEndpoints(DARK_FORMULAS.outlinedIconRestToneLight);
  const outlinedIconHoverToneLight = toneEndpoints(DARK_FORMULAS.outlinedIconHoverToneLight);
  const outlinedIconActiveToneLight = toneEndpoints(DARK_FORMULAS.outlinedIconActiveToneLight);
  // Ghost control
  const ghostTextRestTone = toneEndpoints(DARK_FORMULAS.ghostTextRestTone);
  const ghostTextHoverTone = toneEndpoints(DARK_FORMULAS.ghostTextHoverTone);
  const ghostTextActiveTone = toneEndpoints(DARK_FORMULAS.ghostTextActiveTone);
  const ghostTextRestIntensity = intensityEndpoints(DARK_FORMULAS.ghostTextRestIntensity);
  const ghostTextHoverIntensity = intensityEndpoints(DARK_FORMULAS.ghostTextHoverIntensity);
  const ghostTextActiveIntensity = intensityEndpoints(DARK_FORMULAS.ghostTextActiveIntensity);
  const ghostIconRestTone = toneEndpoints(DARK_FORMULAS.ghostIconRestTone);
  const ghostIconHoverTone = toneEndpoints(DARK_FORMULAS.ghostIconHoverTone);
  const ghostIconActiveTone = toneEndpoints(DARK_FORMULAS.ghostIconActiveTone);
  const ghostIconRestIntensity = intensityEndpoints(DARK_FORMULAS.ghostIconRestIntensity);
  const ghostIconHoverIntensity = intensityEndpoints(DARK_FORMULAS.ghostIconHoverIntensity);
  const ghostIconActiveIntensity = intensityEndpoints(DARK_FORMULAS.ghostIconActiveIntensity);
  const ghostBorderIntensity = intensityEndpoints(DARK_FORMULAS.ghostBorderIntensity);
  const ghostBorderTone = toneEndpoints(DARK_FORMULAS.ghostBorderTone);
  // Light-mode ghost tone/intensity counterparts
  const ghostTextRestToneLight = toneEndpoints(DARK_FORMULAS.ghostTextRestToneLight);
  const ghostTextHoverToneLight = toneEndpoints(DARK_FORMULAS.ghostTextHoverToneLight);
  const ghostTextActiveToneLight = toneEndpoints(DARK_FORMULAS.ghostTextActiveToneLight);
  const ghostTextRestIntensityLight = intensityEndpoints(DARK_FORMULAS.ghostTextRestIntensityLight);
  const ghostTextHoverIntensityLight = intensityEndpoints(DARK_FORMULAS.ghostTextHoverIntensityLight);
  const ghostTextActiveIntensityLight = intensityEndpoints(DARK_FORMULAS.ghostTextActiveIntensityLight);
  const ghostIconRestToneLight = toneEndpoints(DARK_FORMULAS.ghostIconRestToneLight);
  const ghostIconHoverToneLight = toneEndpoints(DARK_FORMULAS.ghostIconHoverToneLight);
  const ghostIconActiveToneLight = toneEndpoints(DARK_FORMULAS.ghostIconActiveToneLight);
  const ghostIconActiveIntensityLight = intensityEndpoints(DARK_FORMULAS.ghostIconActiveIntensityLight);
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
  const borderBaseIntensity = intensityEndpoints(DARK_FORMULAS.borderBaseIntensity);
  const borderStrongIntensity = intensityEndpoints(DARK_FORMULAS.borderStrongIntensity);
  const borderMutedTone = toneEndpoints(DARK_FORMULAS.borderMutedTone);
  const borderMutedIntensity = intensityEndpoints(DARK_FORMULAS.borderMutedIntensity);
  const borderStrongTone = toneEndpoints(DARK_FORMULAS.borderStrongTone);
  const dividerDefaultIntensity = intensityEndpoints(DARK_FORMULAS.dividerDefaultIntensity);
  const dividerMutedIntensity = intensityEndpoints(DARK_FORMULAS.dividerMutedIntensity);
  const cardFrameActiveIntensity = intensityEndpoints(DARK_FORMULAS.cardFrameActiveIntensity);
  const cardFrameActiveTone = toneEndpoints(DARK_FORMULAS.cardFrameActiveTone);
  const cardFrameInactiveIntensity = intensityEndpoints(DARK_FORMULAS.cardFrameInactiveIntensity);
  const cardFrameInactiveTone = toneEndpoints(DARK_FORMULAS.cardFrameInactiveTone);
  const borderStrongToneComputed = toneEndpoints(DARK_FORMULAS.borderStrongToneComputed);
  const dividerDefaultToneOverride = toneEndpoints(DARK_FORMULAS.dividerDefaultToneOverride!);
  const dividerMutedToneOverride = toneEndpoints(DARK_FORMULAS.dividerMutedToneOverride!);
  const disabledBorderIntensity = intensityEndpoints(DARK_FORMULAS.disabledBorderIntensity);
  const disabledBorderToneOverride = toneEndpoints(DARK_FORMULAS.disabledBorderToneOverride!);
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
  const shadowXsAlpha = alphaEndpoints(DARK_FORMULAS.shadowXsAlpha);
  const shadowMdAlpha = alphaEndpoints(DARK_FORMULAS.shadowMdAlpha);
  const shadowLgAlpha = alphaEndpoints(DARK_FORMULAS.shadowLgAlpha);
  const shadowXlAlpha = alphaEndpoints(DARK_FORMULAS.shadowXlAlpha);
  const shadowOverlayAlpha = alphaEndpoints(DARK_FORMULAS.shadowOverlayAlpha);
  const overlayDimAlpha = alphaEndpoints(DARK_FORMULAS.overlayDimAlpha);
  const overlayScrimAlpha = alphaEndpoints(DARK_FORMULAS.overlayScrimAlpha);
  const overlayHighlightAlpha = alphaEndpoints(DARK_FORMULAS.overlayHighlightAlpha);
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
  const onCautionTextIntensity = intensityEndpoints(DARK_FORMULAS.onCautionTextIntensity);
  const onSuccessTextIntensity = intensityEndpoints(DARK_FORMULAS.onSuccessTextIntensity);
  const badgeTintedTextIntensity = intensityEndpoints(DARK_FORMULAS.badgeTintedTextIntensity);
  const badgeTintedTextTone = toneEndpoints(DARK_FORMULAS.badgeTintedTextTone);
  const badgeTintedSurfaceIntensity = intensityEndpoints(DARK_FORMULAS.badgeTintedSurfaceIntensity);
  const badgeTintedSurfaceTone = toneEndpoints(DARK_FORMULAS.badgeTintedSurfaceTone);
  const badgeTintedSurfaceAlpha = alphaEndpoints(DARK_FORMULAS.badgeTintedSurfaceAlpha);
  const badgeTintedBorderIntensity = intensityEndpoints(DARK_FORMULAS.badgeTintedBorderIntensity);
  const badgeTintedBorderTone = toneEndpoints(DARK_FORMULAS.badgeTintedBorderTone);
  const badgeTintedBorderAlpha = alphaEndpoints(DARK_FORMULAS.badgeTintedBorderAlpha);
  const iconActiveTone = toneEndpoints(DARK_FORMULAS.iconActiveTone);
  const iconMutedIntensity = intensityEndpoints(DARK_FORMULAS.iconMutedIntensity);
  const iconMutedTone = toneEndpoints(DARK_FORMULAS.iconMutedTone);
  const tabTextActiveTone = toneEndpoints(DARK_FORMULAS.tabTextActiveTone);
  const toggleTrackOnHoverTone = toneEndpoints(DARK_FORMULAS.toggleTrackOnHoverTone);
  const toggleThumbDisabledTone = toneEndpoints(DARK_FORMULAS.toggleThumbDisabledTone);
  const toggleTrackDisabledIntensity = intensityEndpoints(DARK_FORMULAS.toggleTrackDisabledIntensity);
  const ghostActionSurfaceHoverAlpha = alphaEndpoints(DARK_FORMULAS.ghostActionSurfaceHoverAlpha);
  const ghostActionSurfaceActiveAlpha = alphaEndpoints(DARK_FORMULAS.ghostActionSurfaceActiveAlpha);
  const ghostOptionSurfaceHoverAlpha = alphaEndpoints(DARK_FORMULAS.ghostOptionSurfaceHoverAlpha);
  const ghostOptionSurfaceActiveAlpha = alphaEndpoints(DARK_FORMULAS.ghostOptionSurfaceActiveAlpha);
  const ghostDangerSurfaceHoverAlpha = alphaEndpoints(DARK_FORMULAS.ghostDangerSurfaceHoverAlpha);
  const ghostDangerSurfaceActiveAlpha = alphaEndpoints(DARK_FORMULAS.ghostDangerSurfaceActiveAlpha);
  const tabSurfaceHoverAlpha = alphaEndpoints(DARK_FORMULAS.tabSurfaceHoverAlpha);
  const tabCloseSurfaceHoverAlpha = alphaEndpoints(DARK_FORMULAS.tabCloseSurfaceHoverAlpha);
  const highlightHoverAlpha = alphaEndpoints(DARK_FORMULAS.highlightHoverAlpha);
  const selectionSurfaceInactiveIntensity = intensityEndpoints(DARK_FORMULAS.selectionSurfaceInactiveIntensity);
  const selectionSurfaceInactiveTone = toneEndpoints(DARK_FORMULAS.selectionSurfaceInactiveTone);
  const selectionSurfaceInactiveAlpha = alphaEndpoints(DARK_FORMULAS.selectionSurfaceInactiveAlpha);
  // Extra signal-tone fields (omitted from roadmap tables)
  const borderSignalTone = toneEndpoints(DARK_FORMULAS.borderSignalTone);
  const semanticSignalTone = toneEndpoints(DARK_FORMULAS.semanticSignalTone);
  const accentSubtleTone = toneEndpoints(DARK_FORMULAS.accentSubtleTone);
  const cautionSurfaceTone = toneEndpoints(DARK_FORMULAS.cautionSurfaceTone);
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
  const atmosphereIntensity = intensityEndpoints(DARK_FORMULAS.atmosphereIntensity);
  const surfaceAppIntensity = intensityEndpoints(DARK_FORMULAS.surfaceAppIntensity);
  const surfaceCanvasIntensity = intensityEndpoints(DARK_FORMULAS.surfaceCanvasIntensity);
  const atmosphereBorderIntensity = intensityEndpoints(DARK_FORMULAS.atmosphereBorderIntensity);
  const fieldSurfaceRestTone = toneEndpoints(DARK_FORMULAS.fieldSurfaceRestTone);
  const fieldSurfaceHoverTone = toneEndpoints(DARK_FORMULAS.fieldSurfaceHoverTone);
  const fieldSurfaceFocusTone = toneEndpoints(DARK_FORMULAS.fieldSurfaceFocusTone);
  const fieldSurfaceDisabledTone = toneEndpoints(DARK_FORMULAS.fieldSurfaceDisabledTone);
  const fieldSurfaceReadOnlyTone = toneEndpoints(DARK_FORMULAS.fieldSurfaceReadOnlyTone);
  const fieldSurfaceRestIntensity = intensityEndpoints(DARK_FORMULAS.fieldSurfaceRestIntensity);
  const disabledSurfaceIntensity = intensityEndpoints(DARK_FORMULAS.disabledSurfaceIntensity);
  const disabledSurfaceToneBase = toneEndpoints(DARK_FORMULAS.disabledSurfaceToneBase);
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
  const surfaceAppTone = toneEndpoints(LIGHT_FORMULAS.surfaceAppTone);
  const surfaceCanvasTone = toneEndpoints(LIGHT_FORMULAS.surfaceCanvasTone);
  const surfaceSunkenTone = toneEndpoints(LIGHT_FORMULAS.surfaceSunkenTone);
  const surfaceDefaultTone = toneEndpoints(LIGHT_FORMULAS.surfaceDefaultTone);
  const surfaceRaisedTone = toneEndpoints(LIGHT_FORMULAS.surfaceRaisedTone);
  const surfaceOverlayTone = toneEndpoints(LIGHT_FORMULAS.surfaceOverlayTone);
  const surfaceInsetTone = toneEndpoints(LIGHT_FORMULAS.surfaceInsetTone);
  const surfaceContentTone = toneEndpoints(LIGHT_FORMULAS.surfaceContentTone);
  const surfaceScreenTone = toneEndpoints(LIGHT_FORMULAS.surfaceScreenTone);
  const surfaceDefaultIntensity = intensityEndpoints(LIGHT_FORMULAS.surfaceDefaultIntensity);
  const surfaceRaisedIntensity = intensityEndpoints(LIGHT_FORMULAS.surfaceRaisedIntensity);
  const surfaceOverlayIntensity = intensityEndpoints(LIGHT_FORMULAS.surfaceOverlayIntensity);
  const surfaceScreenIntensity = intensityEndpoints(LIGHT_FORMULAS.surfaceScreenIntensity);
  const surfaceInsetIntensity = intensityEndpoints(LIGHT_FORMULAS.surfaceInsetIntensity);
  const surfaceContentIntensity = intensityEndpoints(LIGHT_FORMULAS.surfaceContentIntensity);
  const surfaceAppBaseIntensity = intensityEndpoints(LIGHT_FORMULAS.surfaceAppBaseIntensity);
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
  const contentTextTone = toneEndpointsWide(LIGHT_FORMULAS.contentTextTone); // low=0, high=16
  const inverseTextTone = toneEndpoints(LIGHT_FORMULAS.inverseTextTone); // ceiling-anchored; already at max range
  const mutedTextTone = toneEndpointsWide(LIGHT_FORMULAS.mutedTextTone); // low=0, high=68
  const subtleTextTone = toneEndpointsWide(LIGHT_FORMULAS.subtleTextTone); // low=4, high=100 (ceiling-anchored)
  const disabledTextTone = toneEndpointsWide(LIGHT_FORMULAS.disabledTextTone); // low=36, high=100
  const placeholderTextTone = toneEndpointsWide(LIGHT_FORMULAS.placeholderTextTone); // low=20, high=100
  const contentTextIntensity = intensityEndpoints(LIGHT_FORMULAS.contentTextIntensity);
  const subtleTextIntensity = intensityEndpoints(LIGHT_FORMULAS.subtleTextIntensity);
  const mutedTextIntensity = intensityEndpoints(LIGHT_FORMULAS.mutedTextIntensity);
  const inverseTextIntensity = intensityEndpoints(LIGHT_FORMULAS.inverseTextIntensity);
  const disabledTextToneComputed = toneEndpointsWide(LIGHT_FORMULAS.disabledTextToneComputed); // low=24, high=100
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
  const filledSurfaceRestTone = toneEndpointsWide(LIGHT_FORMULAS.filledSurfaceRestTone); // low=0, high=40
  const filledSurfaceHoverTone = toneEndpointsWide(LIGHT_FORMULAS.filledSurfaceHoverTone); // low=0, high=80
  const filledSurfaceActiveTone = toneEndpoints(LIGHT_FORMULAS.filledSurfaceActiveTone); // low=25, high=75 (symmetric)
  // Outlined control (light mode: near-dark tones, ref from LIGHT_FORMULAS)
  const outlinedTextRestTone = toneEndpoints(LIGHT_FORMULAS.outlinedTextRestTone);
  const outlinedTextHoverTone = toneEndpoints(LIGHT_FORMULAS.outlinedTextHoverTone);
  const outlinedTextActiveTone = toneEndpoints(LIGHT_FORMULAS.outlinedTextActiveTone);
  const outlinedTextIntensity = intensityEndpoints(LIGHT_FORMULAS.outlinedTextIntensity);
  const outlinedIconRestTone = toneEndpoints(LIGHT_FORMULAS.outlinedIconRestTone);
  const outlinedIconHoverTone = toneEndpoints(LIGHT_FORMULAS.outlinedIconHoverTone);
  const outlinedIconActiveTone = toneEndpoints(LIGHT_FORMULAS.outlinedIconActiveTone);
  const outlinedIconIntensity = intensityEndpoints(LIGHT_FORMULAS.outlinedIconIntensity);
  const outlinedSurfaceHoverIntensity = intensityEndpoints(LIGHT_FORMULAS.outlinedSurfaceHoverIntensity);
  const outlinedSurfaceHoverAlpha = alphaEndpoints(LIGHT_FORMULAS.outlinedSurfaceHoverAlpha);
  const outlinedSurfaceActiveIntensity = intensityEndpoints(LIGHT_FORMULAS.outlinedSurfaceActiveIntensity);
  const outlinedSurfaceActiveAlpha = alphaEndpoints(LIGHT_FORMULAS.outlinedSurfaceActiveAlpha);
  const outlinedOptionBorderRestTone = toneEndpoints(LIGHT_FORMULAS.outlinedOptionBorderRestTone);
  const outlinedOptionBorderHoverTone = toneEndpoints(LIGHT_FORMULAS.outlinedOptionBorderHoverTone);
  const outlinedOptionBorderActiveTone = toneEndpoints(LIGHT_FORMULAS.outlinedOptionBorderActiveTone);
  // Light-mode outlined tone counterparts (mode-independent: pure black = 0)
  const outlinedTextRestToneLight = toneEndpoints(LIGHT_FORMULAS.outlinedTextRestToneLight);
  const outlinedTextHoverToneLight = toneEndpoints(LIGHT_FORMULAS.outlinedTextHoverToneLight);
  const outlinedTextActiveToneLight = toneEndpoints(LIGHT_FORMULAS.outlinedTextActiveToneLight);
  const outlinedIconRestToneLight = toneEndpoints(LIGHT_FORMULAS.outlinedIconRestToneLight);
  const outlinedIconHoverToneLight = toneEndpoints(LIGHT_FORMULAS.outlinedIconHoverToneLight);
  const outlinedIconActiveToneLight = toneEndpoints(LIGHT_FORMULAS.outlinedIconActiveToneLight);
  // Ghost control (light mode: near-dark tones)
  const ghostTextRestTone = toneEndpoints(LIGHT_FORMULAS.ghostTextRestTone);
  const ghostTextHoverTone = toneEndpoints(LIGHT_FORMULAS.ghostTextHoverTone);
  const ghostTextActiveTone = toneEndpoints(LIGHT_FORMULAS.ghostTextActiveTone);
  const ghostTextRestIntensity = intensityEndpoints(LIGHT_FORMULAS.ghostTextRestIntensity);
  const ghostTextHoverIntensity = intensityEndpoints(LIGHT_FORMULAS.ghostTextHoverIntensity);
  const ghostTextActiveIntensity = intensityEndpoints(LIGHT_FORMULAS.ghostTextActiveIntensity);
  const ghostIconRestTone = toneEndpoints(LIGHT_FORMULAS.ghostIconRestTone);
  const ghostIconHoverTone = toneEndpoints(LIGHT_FORMULAS.ghostIconHoverTone);
  const ghostIconActiveTone = toneEndpoints(LIGHT_FORMULAS.ghostIconActiveTone);
  const ghostIconRestIntensity = intensityEndpoints(LIGHT_FORMULAS.ghostIconRestIntensity);
  const ghostIconHoverIntensity = intensityEndpoints(LIGHT_FORMULAS.ghostIconHoverIntensity);
  const ghostIconActiveIntensity = intensityEndpoints(LIGHT_FORMULAS.ghostIconActiveIntensity);
  const ghostBorderIntensity = intensityEndpoints(LIGHT_FORMULAS.ghostBorderIntensity);
  const ghostBorderTone = toneEndpoints(LIGHT_FORMULAS.ghostBorderTone);
  // Light-mode ghost tone/intensity counterparts (mode-independent: pure black)
  const ghostTextRestToneLight = toneEndpoints(LIGHT_FORMULAS.ghostTextRestToneLight);
  const ghostTextHoverToneLight = toneEndpoints(LIGHT_FORMULAS.ghostTextHoverToneLight);
  const ghostTextActiveToneLight = toneEndpoints(LIGHT_FORMULAS.ghostTextActiveToneLight);
  const ghostTextRestIntensityLight = intensityEndpoints(LIGHT_FORMULAS.ghostTextRestIntensityLight);
  const ghostTextHoverIntensityLight = intensityEndpoints(LIGHT_FORMULAS.ghostTextHoverIntensityLight);
  const ghostTextActiveIntensityLight = intensityEndpoints(LIGHT_FORMULAS.ghostTextActiveIntensityLight);
  const ghostIconRestToneLight = toneEndpoints(LIGHT_FORMULAS.ghostIconRestToneLight);
  const ghostIconHoverToneLight = toneEndpoints(LIGHT_FORMULAS.ghostIconHoverToneLight);
  const ghostIconActiveToneLight = toneEndpoints(LIGHT_FORMULAS.ghostIconActiveToneLight);
  const ghostIconActiveIntensityLight = intensityEndpoints(LIGHT_FORMULAS.ghostIconActiveIntensityLight);
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
  const borderBaseIntensity = intensityEndpoints(LIGHT_FORMULAS.borderBaseIntensity);
  const borderStrongIntensity = intensityEndpoints(LIGHT_FORMULAS.borderStrongIntensity);
  const borderMutedTone = toneEndpoints(LIGHT_FORMULAS.borderMutedTone);
  const borderMutedIntensity = intensityEndpoints(LIGHT_FORMULAS.borderMutedIntensity);
  const borderStrongTone = toneEndpoints(LIGHT_FORMULAS.borderStrongTone);
  const dividerDefaultIntensity = intensityEndpoints(LIGHT_FORMULAS.dividerDefaultIntensity);
  const dividerMutedIntensity = intensityEndpoints(LIGHT_FORMULAS.dividerMutedIntensity);
  const cardFrameActiveIntensity = intensityEndpoints(LIGHT_FORMULAS.cardFrameActiveIntensity);
  const cardFrameActiveTone = toneEndpoints(LIGHT_FORMULAS.cardFrameActiveTone);
  const cardFrameInactiveIntensity = intensityEndpoints(LIGHT_FORMULAS.cardFrameInactiveIntensity);
  const cardFrameInactiveTone = toneEndpoints(LIGHT_FORMULAS.cardFrameInactiveTone);
  const borderStrongToneComputed = toneEndpoints(LIGHT_FORMULAS.borderStrongToneComputed);
  const dividerDefaultToneOverride = toneEndpoints(LIGHT_FORMULAS.dividerDefaultToneOverride!);
  const dividerMutedToneOverride = toneEndpoints(LIGHT_FORMULAS.dividerMutedToneOverride!);
  const disabledBorderIntensity = intensityEndpoints(LIGHT_FORMULAS.disabledBorderIntensity);
  const disabledBorderToneOverride = toneEndpoints(LIGHT_FORMULAS.disabledBorderToneOverride!);
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
  const shadowXsAlpha = alphaEndpoints(LIGHT_FORMULAS.shadowXsAlpha);
  const shadowMdAlpha = alphaEndpoints(LIGHT_FORMULAS.shadowMdAlpha);
  const shadowLgAlpha = alphaEndpoints(LIGHT_FORMULAS.shadowLgAlpha);
  const shadowXlAlpha = alphaEndpoints(LIGHT_FORMULAS.shadowXlAlpha);
  const shadowOverlayAlpha = alphaEndpoints(LIGHT_FORMULAS.shadowOverlayAlpha);
  const overlayDimAlpha = alphaEndpoints(LIGHT_FORMULAS.overlayDimAlpha);
  const overlayScrimAlpha = alphaEndpoints(LIGHT_FORMULAS.overlayScrimAlpha);
  const overlayHighlightAlpha = alphaEndpoints(LIGHT_FORMULAS.overlayHighlightAlpha);
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
  const onCautionTextIntensity = intensityEndpoints(LIGHT_FORMULAS.onCautionTextIntensity);
  const onSuccessTextIntensity = intensityEndpoints(LIGHT_FORMULAS.onSuccessTextIntensity);
  const badgeTintedTextIntensity = intensityEndpoints(LIGHT_FORMULAS.badgeTintedTextIntensity);
  const badgeTintedTextTone = toneEndpoints(LIGHT_FORMULAS.badgeTintedTextTone);
  const badgeTintedSurfaceIntensity = intensityEndpoints(LIGHT_FORMULAS.badgeTintedSurfaceIntensity);
  const badgeTintedSurfaceTone = toneEndpoints(LIGHT_FORMULAS.badgeTintedSurfaceTone);
  const badgeTintedSurfaceAlpha = alphaEndpoints(LIGHT_FORMULAS.badgeTintedSurfaceAlpha);
  const badgeTintedBorderIntensity = intensityEndpoints(LIGHT_FORMULAS.badgeTintedBorderIntensity);
  const badgeTintedBorderTone = toneEndpoints(LIGHT_FORMULAS.badgeTintedBorderTone);
  const badgeTintedBorderAlpha = alphaEndpoints(LIGHT_FORMULAS.badgeTintedBorderAlpha);
  const iconActiveTone = toneEndpoints(LIGHT_FORMULAS.iconActiveTone);
  const iconMutedIntensity = intensityEndpoints(LIGHT_FORMULAS.iconMutedIntensity);
  const iconMutedTone = toneEndpoints(LIGHT_FORMULAS.iconMutedTone);
  const tabTextActiveTone = toneEndpoints(LIGHT_FORMULAS.tabTextActiveTone);
  const toggleTrackOnHoverTone = toneEndpoints(LIGHT_FORMULAS.toggleTrackOnHoverTone);
  const toggleThumbDisabledTone = toneEndpoints(LIGHT_FORMULAS.toggleThumbDisabledTone);
  const toggleTrackDisabledIntensity = intensityEndpoints(LIGHT_FORMULAS.toggleTrackDisabledIntensity);
  // Sentinel alphas (mode-independent — same as dark)
  const ghostActionSurfaceHoverAlpha = alphaEndpoints(LIGHT_FORMULAS.ghostActionSurfaceHoverAlpha);
  const ghostActionSurfaceActiveAlpha = alphaEndpoints(LIGHT_FORMULAS.ghostActionSurfaceActiveAlpha);
  const ghostOptionSurfaceHoverAlpha = alphaEndpoints(LIGHT_FORMULAS.ghostOptionSurfaceHoverAlpha);
  const ghostOptionSurfaceActiveAlpha = alphaEndpoints(LIGHT_FORMULAS.ghostOptionSurfaceActiveAlpha);
  const ghostDangerSurfaceHoverAlpha = alphaEndpoints(LIGHT_FORMULAS.ghostDangerSurfaceHoverAlpha);
  const ghostDangerSurfaceActiveAlpha = alphaEndpoints(LIGHT_FORMULAS.ghostDangerSurfaceActiveAlpha);
  const tabSurfaceHoverAlpha = alphaEndpoints(LIGHT_FORMULAS.tabSurfaceHoverAlpha);
  const tabCloseSurfaceHoverAlpha = alphaEndpoints(LIGHT_FORMULAS.tabCloseSurfaceHoverAlpha);
  const highlightHoverAlpha = alphaEndpoints(LIGHT_FORMULAS.highlightHoverAlpha);
  const selectionSurfaceInactiveIntensity = intensityEndpoints(LIGHT_FORMULAS.selectionSurfaceInactiveIntensity);
  const selectionSurfaceInactiveTone = toneEndpoints(LIGHT_FORMULAS.selectionSurfaceInactiveTone);
  const selectionSurfaceInactiveAlpha = alphaEndpoints(LIGHT_FORMULAS.selectionSurfaceInactiveAlpha);
  // Extra signal-tone fields
  const borderSignalTone = toneEndpoints(LIGHT_FORMULAS.borderSignalTone);
  const semanticSignalTone = toneEndpoints(LIGHT_FORMULAS.semanticSignalTone);
  const accentSubtleTone = toneEndpoints(LIGHT_FORMULAS.accentSubtleTone);
  const cautionSurfaceTone = toneEndpoints(LIGHT_FORMULAS.cautionSurfaceTone);
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
  const atmosphereIntensity = intensityEndpoints(LIGHT_FORMULAS.atmosphereIntensity);
  const surfaceAppIntensity = intensityEndpoints(LIGHT_FORMULAS.surfaceAppIntensity);
  const surfaceCanvasIntensity = intensityEndpoints(LIGHT_FORMULAS.surfaceCanvasIntensity);
  const atmosphereBorderIntensity = intensityEndpoints(LIGHT_FORMULAS.atmosphereBorderIntensity);
  const fieldSurfaceRestTone = toneEndpoints(LIGHT_FORMULAS.fieldSurfaceRestTone);
  const fieldSurfaceHoverTone = toneEndpoints(LIGHT_FORMULAS.fieldSurfaceHoverTone);
  const fieldSurfaceFocusTone = toneEndpoints(LIGHT_FORMULAS.fieldSurfaceFocusTone);
  const fieldSurfaceDisabledTone = toneEndpoints(LIGHT_FORMULAS.fieldSurfaceDisabledTone);
  const fieldSurfaceReadOnlyTone = toneEndpoints(LIGHT_FORMULAS.fieldSurfaceReadOnlyTone);
  const fieldSurfaceRestIntensity = intensityEndpoints(LIGHT_FORMULAS.fieldSurfaceRestIntensity);
  const disabledSurfaceIntensity = intensityEndpoints(LIGHT_FORMULAS.disabledSurfaceIntensity);
  const disabledSurfaceToneBase = toneEndpoints(LIGHT_FORMULAS.disabledSurfaceToneBase);
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
