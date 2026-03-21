/**
 * Recipe Functions — Theme Recipe Function System
 *
 * Provides recipe functions that express design relationships via rules
 * and `contrastSearch`, replacing the bag-of-constants approach of
 * DARK_FORMULAS / LIGHT_FORMULAS. [D01]
 *
 * Architecture:
 *   - `RecipeControls` — 6-field interface capturing the fundamental design dials (Spec S01)
 *   - `contrastSearch` — binary search in tone space for a contrast threshold (Spec S02)
 *   - `darkRecipe` — dark theme: rules + contrastSearch calls -> DerivationFormulas
 *   - `lightRecipe` — light theme: independent rules, not derived from dark (D03)
 *   - `defaultDarkControls`, `defaultLightControls` — defaults that reproduce current output
 *   - `RECIPE_REGISTRY` — map of recipe name -> {fn, defaults} (Spec S03)
 *
 * `contrastSearch` uses `toneToL` with the generic fallback (DEFAULT_CANONICAL_L lookup
 * returning 0.77 when hueName is omitted). The downstream `enforceContrastFloor` in
 * `evaluateRules` provides exact hue-aware correction, so recipe-level search results
 * are approximate starting points that the safety net refines. [D02]
 *
 * References: [D01] Recipe functions replace constant bags, [D02] contrastSearch is
 * a clean implementation, [D03] Light recipe is independent, Spec S01, Spec S02,
 * Spec S03, (#recipe-controls, #contrast-search-spec, #recipe-registry)
 *
 * @module components/tugways/recipe-functions
 */

import { DEFAULT_CANONICAL_L, L_DARK, L_LIGHT } from "./palette-engine";
import type { DerivationFormulas } from "./theme-engine";

// ---------------------------------------------------------------------------
// RecipeControls — Spec S01
// ---------------------------------------------------------------------------

/**
 * The six fundamental design controls for a theme recipe.
 * Each field maps to a semantic design decision. (Spec S01)
 *
 * canvasTone:       How dark/light the app background is.
 *                   Dark ~5, light ~95.
 * canvasIntensity:  How chromatic the canvas surfaces are (0-100).
 * frameTone:        Card title bar lightness.
 * frameIntensity:   Card title bar color saturation.
 * roleTone:         Role-colored fill lightness (filled buttons, signals).
 * roleIntensity:    Role color vividness. Maps to signalIntensityValue in the pipeline.
 */
export interface RecipeControls {
  canvasTone: number;
  canvasIntensity: number;
  frameTone: number;
  frameIntensity: number;
  roleTone: number;
  roleIntensity: number;
}

// ---------------------------------------------------------------------------
// contrastSearch — Spec S02
// ---------------------------------------------------------------------------

/**
 * Convert a tone value (0-100) to OKLab L, using optional hue name for
 * canonical-L lookup. Falls back to 0.77 (violet canonical L) when hueName
 * is not provided or not in DEFAULT_CANONICAL_L.
 *
 * This is the same piecewise formula used by enforceContrastFloor and toneToL
 * in theme-accessibility.ts. Duplicated here to avoid a circular import
 * (recipe-functions.ts -> theme-engine.ts -> recipe-functions.ts).
 * Both implementations use the same math. [D02]
 */
function toneToLLocal(tone: number, hueName?: string): number {
  // Generic fallback: 0.77 matches the "violet" canonical L.
  // enforceContrastFloor provides exact hue-aware correction downstream.
  const canonL = (hueName !== undefined ? DEFAULT_CANONICAL_L[hueName] : undefined) ?? 0.77;
  return (
    L_DARK +
    (Math.min(tone, 50) * (canonL - L_DARK)) / 50 +
    (Math.max(tone - 50, 0) * (L_LIGHT - canonL)) / 50
  );
}

/**
 * Compute perceptual contrast between element at elementL and surface at surfaceL.
 * Uses the same CONTRAST_SCALE (150) and POLARITY_FACTOR (0.85) as the engine.
 */
function contrastFromL(elementL: number, surfaceL: number): number {
  const CONTRAST_SCALE = 150;
  const POLARITY_FACTOR = 0.85;
  const CONTRAST_MIN_DELTA = 0.04;

  const deltaL = surfaceL - elementL;
  if (Math.abs(deltaL) < CONTRAST_MIN_DELTA) return 0;
  return deltaL > 0
    ? deltaL * CONTRAST_SCALE
    : deltaL * CONTRAST_SCALE * POLARITY_FACTOR;
}

/**
 * Binary-search in tone space (0-100) for a tone that achieves `threshold`
 * perceptual contrast against `surfaceTone`. (Spec S02)
 *
 * @param surfaceTone - Surface tone (0-100)
 * @param threshold   - Required contrast magnitude (e.g. 75 for content role)
 * @param direction   - "lighter" | "darker" | "auto" (default "auto")
 *                      auto: dark surfaces (tone < 50) -> lighter; light surfaces -> darker
 * @param hueName     - Optional element hue name for more accurate L conversion.
 *                      When omitted, uses generic fallback canonL=0.77 (violet).
 *                      enforceContrastFloor provides hue-aware correction downstream.
 * @returns Found tone, rounded to nearest integer, clamped to [0, 100]
 */
export function contrastSearch(
  surfaceTone: number,
  threshold: number,
  direction?: "lighter" | "darker" | "auto",
  hueName?: string,
): number {
  const resolvedDirection =
    direction === "lighter" || direction === "darker"
      ? direction
      : surfaceTone < 50
        ? "lighter"
        : "darker";

  const surfaceL = toneToLLocal(surfaceTone);

  // Check if the extreme already meets threshold
  const extremeTone = resolvedDirection === "lighter" ? 100 : 0;
  const extremeL = toneToLLocal(extremeTone, hueName);
  const extremeContrast = Math.abs(contrastFromL(extremeL, surfaceL));

  if (extremeContrast < threshold) {
    // Threshold unachievable — return extreme as best available
    return extremeTone;
  }

  // Binary search with 0.5 tone unit precision (20 iterations gives ~2^-20 range)
  let lo = resolvedDirection === "lighter" ? surfaceTone : 0;
  let hi = resolvedDirection === "lighter" ? 100 : surfaceTone;
  let result = extremeTone;

  for (let iter = 0; iter < 20; iter++) {
    const mid = (lo + hi) / 2;
    const midL = toneToLLocal(mid, hueName);
    const midContrast = Math.abs(contrastFromL(midL, surfaceL));

    if (midContrast >= threshold) {
      result = mid;
      // Found passing — try to get closer to surface (less extreme)
      if (resolvedDirection === "lighter") {
        hi = mid;
      } else {
        lo = mid;
      }
    } else {
      // Not passing — push further from surface
      if (resolvedDirection === "lighter") {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    if (hi - lo < 0.5) break;
  }

  return Math.round(Math.max(0, Math.min(100, result)));
}

// ---------------------------------------------------------------------------
// darkRecipe — Dark theme recipe function [D01]
// ---------------------------------------------------------------------------

/**
 * Default RecipeControls for the dark recipe.
 * Values reproduce current DARK_FORMULAS output.
 *   canvasTone:      5  — near-black deep immersive background
 *   canvasIntensity: 5  — moderate atmosphere chroma
 *   frameTone:       16 — card title bar tone (active frame)
 *   frameIntensity:  12 — card title bar chroma (active frame)
 *   roleTone:        50 — mid-tone vivid signal fills
 *   roleIntensity:   50 — neutral default signal intensity
 */
export const defaultDarkControls: RecipeControls = {
  canvasTone: 5,
  canvasIntensity: 5,
  frameTone: 16,
  frameIntensity: 12,
  roleTone: 50,
  roleIntensity: 50,
};

/**
 * Dark theme recipe function. (Spec S01, [D01])
 *
 * Rules are expressed as offsets from controls + contrastSearch calls + constants.
 * All computeTones-era fields are populated with passthrough/neutralizing values
 * (scale=0, center=50, base=desired tone) so the still-existing computeTones()
 * pipeline produces correct results.
 *
 * Derived from DARK_FORMULAS offset analysis via compute-offsets.ts [D07]:
 *   canvasTone = 5 (base)
 *   surface tiers: +1 to +11 above canvas
 *   text: canvas+89 for primary (near-white design intent), -28/-57/-71 offsets for hierarchy
 *   frame: controls.frameTone / controls.frameIntensity
 *   signals: controls.roleTone for filled controls and signal tones
 *
 * Note: contentTextTone uses canvas+89 (a design intent offset) rather than
 * contrastSearch, because the design calls for near-white (tone~94) text on dark
 * backgrounds — significantly above the minimum contrast-passing tone (~58).
 * contrastSearch is used for frameTone-relative values and signals where
 * the minimum-passing tone is the right choice.
 */
export function darkRecipe(controls: RecipeControls): DerivationFormulas {
  const c = controls.canvasTone;

  // Text brightness: design offset from canvas — near-white on dark (canvas+89 → ~94)
  // Not using contrastSearch here because the design intent is maximum legibility
  // (near-white), not just minimum-passing contrast.
  const primaryTextTone = c + 89;

  return {
    // ===== Canvas Darkness =====
    surfaceAppTone: c,
    surfaceCanvasTone: c,

    // ===== Surface Layering =====
    // Offsets from DARK_FORMULAS at canvasTone=5: +6, +7, +6, +9, +1, +1, +11
    surfaceSunkenTone: c + 6,
    surfaceDefaultTone: c + 7,
    surfaceRaisedTone: c + 6,
    surfaceOverlayTone: c + 9,
    surfaceInsetTone: c + 1,
    surfaceContentTone: c + 1,
    surfaceScreenTone: c + 11,

    // ===== Surface Coloring =====
    // Intensity constants — atmosphere hue at moderate chroma
    atmosphereIntensity: controls.canvasIntensity,
    surfaceAppIntensity: 2,
    surfaceCanvasIntensity: 2,
    surfaceDefaultIntensity: 5,
    surfaceRaisedIntensity: 5,
    surfaceOverlayIntensity: 4,
    surfaceScreenIntensity: 7,
    surfaceInsetIntensity: 5,
    surfaceContentIntensity: 5,
    surfaceAppBaseIntensity: 2,

    // ===== Text Brightness =====
    // canvas+89 → ~94 (near-white); pure white for inverse on filled controls
    contentTextTone: primaryTextTone,
    inverseTextTone: 100, // pure white: inverse text on filled controls

    // ===== Text Hierarchy =====
    // Offsets from DARK_FORMULAS at primaryTextTone=94:
    //   mutedTextTone=66 (−28), subtleTextTone=37 (−57),
    //   disabledTextTone=23 (−71), placeholderTextTone=30 (−64)
    mutedTextTone: primaryTextTone - 28,
    subtleTextTone: primaryTextTone - 57,
    disabledTextTone: primaryTextTone - 71,
    placeholderTextTone: primaryTextTone - 64,

    // ===== Text Coloring =====
    contentTextIntensity: 3,
    subtleTextIntensity: 7,
    mutedTextIntensity: 5,
    atmosphereBorderIntensity: 6,
    inverseTextIntensity: 3,
    onCautionTextIntensity: 4,
    onSuccessTextIntensity: 4,

    // ===== Border Visibility =====
    borderBaseIntensity: 6,
    borderStrongIntensity: 7,
    // borderMutedTone=37 (matches subtleTextTone: primaryTextTone−57)
    borderMutedTone: primaryTextTone - 57,
    borderMutedIntensity: 7,
    // borderStrongTone=40 (slightly above muted: primaryTextTone−54)
    borderStrongTone: primaryTextTone - 54,
    dividerDefaultIntensity: 6,
    dividerMutedIntensity: 4,
    borderSignalTone: controls.roleTone, // signal borders use role tone (=50)
    semanticSignalTone: controls.roleTone,

    // ===== Card Frame Style =====
    cardFrameActiveIntensity: controls.frameIntensity,
    cardFrameActiveTone: controls.frameTone,
    cardFrameInactiveIntensity: 4,
    cardFrameInactiveTone: controls.frameTone - 1,

    // ===== Shadow Depth =====
    shadowXsAlpha: 20,
    shadowMdAlpha: 60,
    shadowLgAlpha: 70,
    shadowXlAlpha: 80,
    shadowOverlayAlpha: 60,
    overlayDimAlpha: 48,
    overlayScrimAlpha: 64,
    overlayHighlightAlpha: 6,

    // ===== Filled Control Prominence =====
    // Offsets from DARK_FORMULAS: rest=20 (canvas+15), hover=40 (canvas+35), active=50 (canvas+45)
    filledSurfaceRestTone: c + 15,
    filledSurfaceHoverTone: c + 35,
    filledSurfaceActiveTone: c + 45,

    // ===== Outlined Control Style =====
    // Dark: fg is near-white (100), legacy light counterparts are pure black (0)
    outlinedTextRestTone: 100,
    outlinedTextHoverTone: 100,
    outlinedTextActiveTone: 100,
    outlinedTextIntensity: 2,
    outlinedIconRestTone: 100,
    outlinedIconHoverTone: 100,
    outlinedIconActiveTone: 100,
    outlinedIconIntensity: 2,
    outlinedTextRestToneLight: 0,
    outlinedTextHoverToneLight: 0,
    outlinedTextActiveToneLight: 0,
    outlinedIconRestToneLight: 0,
    outlinedIconHoverToneLight: 0,
    outlinedIconActiveToneLight: 0,
    // Option border: mid-tone (roleTone=50) and +5/+10 for hover/active
    outlinedOptionBorderRestTone: controls.roleTone,
    outlinedOptionBorderHoverTone: controls.roleTone + 5,
    outlinedOptionBorderActiveTone: controls.roleTone + 10,
    outlinedSurfaceHoverIntensity: 0, // sentinel path
    outlinedSurfaceHoverAlpha: 10,
    outlinedSurfaceActiveIntensity: 0, // sentinel path
    outlinedSurfaceActiveAlpha: 20,

    // ===== Ghost Control Style =====
    // Dark: fg is near-white (100), legacy light counterparts are pure black (0)
    ghostTextRestTone: 100,
    ghostTextHoverTone: 100,
    ghostTextActiveTone: 100,
    ghostTextRestIntensity: 2,
    ghostTextHoverIntensity: 2,
    ghostTextActiveIntensity: 2,
    ghostIconRestTone: 100,
    ghostIconHoverTone: 100,
    ghostIconActiveTone: 100,
    ghostIconRestIntensity: 2,
    ghostIconHoverIntensity: 2,
    ghostIconActiveIntensity: 2,
    ghostBorderIntensity: 20,
    ghostBorderTone: c + 55, // mid-bright tone visible on dark surfaces (=60)
    ghostTextRestToneLight: 0,
    ghostTextHoverToneLight: 0,
    ghostTextActiveToneLight: 0,
    ghostTextRestIntensityLight: 0,
    ghostTextHoverIntensityLight: 0,
    ghostTextActiveIntensityLight: 0,
    ghostIconRestToneLight: 0,
    ghostIconHoverToneLight: 0,
    ghostIconActiveToneLight: 0,
    ghostIconActiveIntensityLight: 0,

    // ===== Badge Style =====
    // Dark: bright fg (85 = primaryTextTone−9) on dark tinted bg (60 = c+55), mid-tone border (50)
    badgeTintedTextIntensity: 72,
    badgeTintedTextTone: primaryTextTone - 9, // ~85: near-white fg on dark tinted bg
    badgeTintedSurfaceIntensity: 65,
    badgeTintedSurfaceTone: c + 55, // matches ghostBorderTone: 60
    badgeTintedSurfaceAlpha: 15,
    badgeTintedBorderIntensity: 50,
    badgeTintedBorderTone: controls.roleTone, // 50
    badgeTintedBorderAlpha: 35,

    // ===== Icon Style =====
    // iconActiveTone=80 (primaryTextTone−14): vivid but below primary to avoid blending
    iconActiveTone: primaryTextTone - 14,
    iconMutedIntensity: 7,
    // iconMutedTone=37 (matches subtleTextTone: primaryTextTone−57)
    iconMutedTone: primaryTextTone - 57,

    // ===== Tab Style =====
    // tabTextActiveTone=90 (primaryTextTone−4): near-white, clearly above inactive
    tabTextActiveTone: primaryTextTone - 4,

    // ===== Toggle Style =====
    toggleTrackOnHoverTone: c + 40, // mid-tone hover track: 45
    toggleThumbDisabledTone: c + 35, // dim thumb when disabled: 40
    toggleTrackDisabledIntensity: 5,

    // ===== Field Style =====
    // Field bg tones are offsets from canvas (DARK_FORMULAS: +3, +6, +2, +1, +6)
    fieldSurfaceRestTone: c + 3,
    fieldSurfaceHoverTone: c + 6,
    fieldSurfaceFocusTone: c + 2,
    fieldSurfaceDisabledTone: c + 1,
    fieldSurfaceReadOnlyTone: c + 6,
    fieldSurfaceRestIntensity: 5,
    disabledSurfaceIntensity: 5,
    disabledBorderIntensity: 6,

    // ===== Signal / Accent Tones =====
    // accentSubtleTone: darker (canvas+25=30) so fg-default achieves contrast ≥75 [phase-3-bug B04]
    accentSubtleTone: c + 25,
    cautionSurfaceTone: c + 25, // same rationale [phase-3-bug B05]

    // ===== Hue Slot Dispatch =====
    // These are mode-independent routing decisions; same as DARK_FORMULAS
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

    // ===== Sentinel Alpha =====
    tabSurfaceHoverAlpha: 8,
    tabCloseSurfaceHoverAlpha: 12,
    ghostActionSurfaceHoverAlpha: 10,
    ghostActionSurfaceActiveAlpha: 20,
    ghostOptionSurfaceHoverAlpha: 10,
    ghostOptionSurfaceActiveAlpha: 20,
    highlightHoverAlpha: 5,
    ghostDangerSurfaceHoverAlpha: 10,
    ghostDangerSurfaceActiveAlpha: 20,

    // ===== Computed Tone Override =====
    // Dividers sit just above surfaceScreen
    dividerDefaultToneOverride: c + 12,
    dividerMutedToneOverride: c + 10,
    disabledTextToneComputed: primaryTextTone - 56, // slightly above subtleTextTone: 38
    disabledBorderToneOverride: c + 23,
    outlinedSurfaceRestToneOverride: null,
    outlinedSurfaceHoverToneOverride: null,
    outlinedSurfaceActiveToneOverride: null,
    toggleTrackOffToneOverride: c + 23,
    toggleDisabledToneOverride: c + 17,
    borderStrongToneComputed: Math.round(primaryTextTone - 57), // matches subtleTextTone: 37

    // ===== computeTones-era passthrough fields =====
    // surfaceContrast is fixed at 50 in deriveTheme(), so these values neutralize
    // any modulation: scale=0 means zero adjustment; base=desired final tone.
    // surfaceCanvasToneBase/Center/Scale: at scale=8 and center=50 with knob=50:
    //   computedCanvas = base + scale*(knob-center)/50 = base + 8*(50-50)/50 = base
    // So base=c reproduces canvasTone correctly.
    surfaceCanvasToneBase: c,
    surfaceCanvasToneCenter: 50,
    surfaceCanvasToneScale: 8,
    // disabledSurfaceToneBase: at scale=0, computedDisabled = base = desired value
    disabledSurfaceToneBase: c + 17,
    disabledSurfaceToneScale: 0,

    // ===== Hue Name Dispatch =====
    // Dark mode: indigo screen bg, bare-primary muted, indigo-cobalt subtle/disabled
    surfaceScreenHueExpression: "indigo",
    mutedTextHueExpression: "__bare_primary",
    subtleTextHueExpression: "indigo-cobalt",
    disabledTextHueExpression: "indigo-cobalt",
    inverseTextHueExpression: "sapphire-cobalt",
    placeholderTextHueExpression: "fgMuted",
    selectionInactiveHueExpression: "yellow",

    // ===== Selection Mode =====
    selectionInactiveSemanticMode: true,
    selectionSurfaceInactiveIntensity: 0,
    selectionSurfaceInactiveTone: c + 25,
    selectionSurfaceInactiveAlpha: 25,

    // ===== Signal Intensity Value =====
    signalIntensityValue: controls.roleIntensity,
  };
}

// ---------------------------------------------------------------------------
// lightRecipe — Light theme recipe function [D01] [D03]
// ---------------------------------------------------------------------------

/**
 * Default RecipeControls for the light recipe.
 * Values reproduce current LIGHT_FORMULAS output.
 *   canvasTone:      95 — near-white open airy background
 *   canvasIntensity: 6  — moderate atmosphere chroma
 *   frameTone:       85 — card title bar tone (active frame, below canvas)
 *   frameIntensity:  35 — strong chroma for vivid light-mode title bar
 *   roleTone:        50 — mid-tone vivid signal fills (same as dark)
 *   roleIntensity:   50 — neutral default signal intensity
 */
export const defaultLightControls: RecipeControls = {
  canvasTone: 95,
  canvasIntensity: 6,
  frameTone: 85,
  frameIntensity: 35,
  roleTone: 50,
  roleIntensity: 50,
};

/**
 * Light theme recipe function. Independent from darkRecipe — not derived by
 * inverting parameters. (D03)
 *
 * Light tone dynamics are inverted: surfaces descend from near-white (~95),
 * text ascends from near-black (~8). contrastSearch direction is "darker"
 * for element tones on light surfaces.
 *
 * Derived from LIGHT_FORMULAS offset analysis via compute-offsets.ts [D07]:
 *   canvasTone = 95 (base)
 *   surface tiers: -2 to -10 below canvas
 *   text: canvas-87 for primary (near-black design intent), +26/+44/+60 offsets for hierarchy
 *   frame: controls.frameTone / controls.frameIntensity
 *
 * Note: contentTextTone uses canvas-87 (a design intent offset → ~8) rather than
 * contrastSearch, because the design calls for near-black text on light backgrounds.
 */
export function lightRecipe(controls: RecipeControls): DerivationFormulas {
  const c = controls.canvasTone;

  // Text brightness: design offset from canvas — near-black on light (canvas-87 → ~8)
  const primaryTextTone = c - 87;

  return {
    // ===== Canvas Darkness =====
    surfaceAppTone: c,
    surfaceCanvasTone: c,

    // ===== Surface Layering =====
    // Offsets from LIGHT_FORMULAS at canvasTone=95: -7, -5, -3, -2, -9, -9, -10
    surfaceSunkenTone: c - 7,
    surfaceDefaultTone: c - 5,
    surfaceRaisedTone: c - 3,
    surfaceOverlayTone: c - 2,
    surfaceInsetTone: c - 9,
    surfaceContentTone: c - 9,
    surfaceScreenTone: c - 10,

    // ===== Surface Coloring =====
    atmosphereIntensity: controls.canvasIntensity,
    surfaceAppIntensity: 3,
    surfaceCanvasIntensity: 3,
    surfaceDefaultIntensity: 6,
    surfaceRaisedIntensity: 6,
    surfaceOverlayIntensity: 5,
    surfaceScreenIntensity: 8,
    surfaceInsetIntensity: 6,
    surfaceContentIntensity: 6,
    surfaceAppBaseIntensity: 3,

    // ===== Text Brightness =====
    // canvas-87 → ~8 (near-black); near-white for inverse on filled controls
    contentTextTone: primaryTextTone,
    inverseTextTone: 94, // near-white: inverse text on filled controls stays near-white

    // ===== Text Hierarchy =====
    // Offsets from LIGHT_FORMULAS at primaryTextTone=8:
    //   mutedTextTone=34 (+26), subtleTextTone=52 (+44),
    //   disabledTextTone=68 (+60), placeholderTextTone=60 (+52)
    mutedTextTone: primaryTextTone + 26,
    subtleTextTone: primaryTextTone + 44,
    disabledTextTone: primaryTextTone + 60,
    placeholderTextTone: primaryTextTone + 52,

    // ===== Text Coloring =====
    contentTextIntensity: 4,
    subtleTextIntensity: 8,
    mutedTextIntensity: 6,
    atmosphereBorderIntensity: 7,
    inverseTextIntensity: 3,
    onCautionTextIntensity: 5,
    onSuccessTextIntensity: 5,

    // ===== Border Visibility =====
    borderBaseIntensity: 8,
    borderStrongIntensity: 10,
    // borderMutedTone=62 (primaryTextTone+54), borderStrongTone=52 (primaryTextTone+44=subtleTextTone)
    borderMutedTone: primaryTextTone + 54,
    borderMutedIntensity: 8,
    borderStrongTone: primaryTextTone + 44, // matches subtleTextTone: 52
    dividerDefaultIntensity: 7,
    dividerMutedIntensity: 5,
    borderSignalTone: c - 55, // 40 in LIGHT_FORMULAS: darker signal tones on light bg
    semanticSignalTone: c - 60, // 35 in LIGHT_FORMULAS

    // ===== Card Frame Style =====
    cardFrameActiveIntensity: controls.frameIntensity,
    cardFrameActiveTone: controls.frameTone,
    cardFrameInactiveIntensity: 5,
    cardFrameInactiveTone: c - 5, // matches surfaceDefaultTone: 90

    // ===== Shadow Depth =====
    shadowXsAlpha: 10,
    shadowMdAlpha: 25,
    shadowLgAlpha: 35,
    shadowXlAlpha: 40,
    shadowOverlayAlpha: 30,
    overlayDimAlpha: 32,
    overlayScrimAlpha: 48,
    overlayHighlightAlpha: 4,

    // ===== Filled Control Prominence =====
    // Light mode: same bold tone approach as dark — filled buttons stay vivid
    filledSurfaceRestTone: 20,
    filledSurfaceHoverTone: 40,
    filledSurfaceActiveTone: 50,

    // ===== Outlined Control Style =====
    // Light: fg is near-dark (primaryTextTone=8)
    outlinedTextRestTone: primaryTextTone,
    outlinedTextHoverTone: primaryTextTone,
    outlinedTextActiveTone: primaryTextTone,
    outlinedTextIntensity: 4,
    outlinedIconRestTone: primaryTextTone,
    outlinedIconHoverTone: primaryTextTone,
    outlinedIconActiveTone: primaryTextTone,
    outlinedIconIntensity: 4,
    outlinedTextRestToneLight: 0,
    outlinedTextHoverToneLight: 0,
    outlinedTextActiveToneLight: 0,
    outlinedIconRestToneLight: 0,
    outlinedIconHoverToneLight: 0,
    outlinedIconActiveToneLight: 0,
    outlinedOptionBorderRestTone: controls.roleTone, // 50
    outlinedOptionBorderHoverTone: controls.roleTone + 5, // 55
    outlinedOptionBorderActiveTone: controls.roleTone + 10, // 60
    // Light mode: direct chroma path, fully opaque
    outlinedSurfaceHoverIntensity: 4,
    outlinedSurfaceHoverAlpha: 100,
    outlinedSurfaceActiveIntensity: 6,
    outlinedSurfaceActiveAlpha: 100,

    // ===== Ghost Control Style =====
    // Light: fg is near-dark (primaryTextTone=8)
    ghostTextRestTone: primaryTextTone,
    ghostTextHoverTone: primaryTextTone,
    ghostTextActiveTone: primaryTextTone,
    ghostTextRestIntensity: 4,
    ghostTextHoverIntensity: 4,
    ghostTextActiveIntensity: 4,
    ghostIconRestTone: primaryTextTone,
    ghostIconHoverTone: primaryTextTone,
    ghostIconActiveTone: primaryTextTone,
    ghostIconRestIntensity: 4,
    ghostIconHoverIntensity: 4,
    ghostIconActiveIntensity: 4,
    ghostBorderIntensity: 20,
    ghostBorderTone: c - 60, // 35 in LIGHT_FORMULAS: darker border on light surfaces
    ghostTextRestToneLight: 0,
    ghostTextHoverToneLight: 0,
    ghostTextActiveToneLight: 0,
    ghostTextRestIntensityLight: 0,
    ghostTextHoverIntensityLight: 0,
    ghostTextActiveIntensityLight: 0,
    ghostIconRestToneLight: 0,
    ghostIconHoverToneLight: 0,
    ghostIconActiveToneLight: 0,
    ghostIconActiveIntensityLight: 0,

    // ===== Badge Style =====
    // Light: dark fg (primaryTextTone+7=15) on light tinted bg (c-15=80), mid-dark border (c-55=40)
    badgeTintedTextIntensity: 72,
    badgeTintedTextTone: primaryTextTone + 7, // ~15: near-dark fg on light tinted bg
    badgeTintedSurfaceIntensity: 65,
    badgeTintedSurfaceTone: c - 15, // light bg: 80 in LIGHT_FORMULAS
    badgeTintedSurfaceAlpha: 20,
    badgeTintedBorderIntensity: 50,
    badgeTintedBorderTone: c - 55, // matches borderSignalTone: 40
    badgeTintedBorderAlpha: 40,

    // ===== Icon Style =====
    // iconActiveTone=20 (primaryTextTone+12): near-dark, vivid on light bg
    iconActiveTone: primaryTextTone + 12,
    iconMutedIntensity: 7,
    // iconMutedTone=52 (matches subtleTextTone: primaryTextTone+44)
    iconMutedTone: primaryTextTone + 44,

    // ===== Tab Style =====
    // tabTextActiveTone=10 (primaryTextTone+2): near-black active tab label
    tabTextActiveTone: primaryTextTone + 2,

    // ===== Toggle Style =====
    toggleTrackOnHoverTone: c - 60, // 35 in LIGHT_FORMULAS
    toggleThumbDisabledTone: c - 30, // 65 in LIGHT_FORMULAS
    toggleTrackDisabledIntensity: 5,

    // ===== Field Style =====
    // Field bg tones are offsets from canvas (LIGHT_FORMULAS: -4, -7, -3, -1, -7)
    fieldSurfaceRestTone: c - 4,
    fieldSurfaceHoverTone: c - 7,
    fieldSurfaceFocusTone: c - 3,
    fieldSurfaceDisabledTone: c - 1,
    fieldSurfaceReadOnlyTone: c - 7,
    fieldSurfaceRestIntensity: 5,
    disabledSurfaceIntensity: 4,
    disabledBorderIntensity: 6,

    // ===== Signal / Accent Tones =====
    accentSubtleTone: controls.roleTone, // 50 in LIGHT_FORMULAS
    cautionSurfaceTone: c - 60, // 35 in LIGHT_FORMULAS: matches semanticSignalTone

    // ===== Hue Slot Dispatch =====
    // Mode-independent routing (same as DARK_FORMULAS)
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

    // ===== Sentinel Alpha =====
    tabSurfaceHoverAlpha: 8,
    tabCloseSurfaceHoverAlpha: 12,
    ghostActionSurfaceHoverAlpha: 10,
    ghostActionSurfaceActiveAlpha: 20,
    ghostOptionSurfaceHoverAlpha: 10,
    ghostOptionSurfaceActiveAlpha: 20,
    highlightHoverAlpha: 5,
    ghostDangerSurfaceHoverAlpha: 10,
    ghostDangerSurfaceActiveAlpha: 20,

    // ===== Computed Tone Override =====
    dividerDefaultToneOverride: c - 17, // 78 in LIGHT_FORMULAS
    dividerMutedToneOverride: c - 13, // 82 in LIGHT_FORMULAS
    disabledTextToneComputed: primaryTextTone + 54, // 62 in LIGHT_FORMULAS
    disabledBorderToneOverride: c - 23, // 72 in LIGHT_FORMULAS
    outlinedSurfaceRestToneOverride: null,
    outlinedSurfaceHoverToneOverride: null,
    outlinedSurfaceActiveToneOverride: null,
    toggleTrackOffToneOverride: c - 23, // 72 in LIGHT_FORMULAS
    toggleDisabledToneOverride: c - 15, // 80 in LIGHT_FORMULAS
    borderStrongToneComputed: c - 55, // 40 in LIGHT_FORMULAS: matches borderSignalTone

    // ===== computeTones-era passthrough fields =====
    // At scale=8, center=50, knob=50: computedCanvas = base + 8*(50-50)/50 = base = c
    surfaceCanvasToneBase: c,
    surfaceCanvasToneCenter: 50,
    surfaceCanvasToneScale: 8,
    disabledSurfaceToneBase: c - 17, // 78 in LIGHT_FORMULAS
    disabledSurfaceToneScale: 0,

    // ===== Hue Name Dispatch =====
    // Light mode: cobalt screen bg (vs dark's indigo), atm placeholder (vs dark's fgMuted)
    surfaceScreenHueExpression: "cobalt",
    mutedTextHueExpression: "__bare_primary",
    subtleTextHueExpression: "indigo-cobalt",
    disabledTextHueExpression: "indigo-cobalt",
    inverseTextHueExpression: "sapphire-cobalt",
    placeholderTextHueExpression: "atm",
    selectionInactiveHueExpression: "yellow",

    // ===== Selection Mode =====
    selectionInactiveSemanticMode: false,
    selectionSurfaceInactiveIntensity: 8, // light mode: uses chroma for inactive selection
    selectionSurfaceInactiveTone: c - 15, // 80 in LIGHT_FORMULAS
    selectionSurfaceInactiveAlpha: 30,

    // ===== Signal Intensity Value =====
    signalIntensityValue: controls.roleIntensity,
  };
}

// ---------------------------------------------------------------------------
// RECIPE_REGISTRY — Spec S03
// ---------------------------------------------------------------------------

/**
 * Built-in recipe registry. Maps recipe name to {fn, defaults}.
 * Used by deriveTheme() when recipe.controls is provided. (Spec S03)
 */
export const RECIPE_REGISTRY: Record<
  string,
  {
    fn: (controls: RecipeControls) => DerivationFormulas;
    defaults: RecipeControls;
  }
> = {
  dark: { fn: darkRecipe, defaults: defaultDarkControls },
  light: { fn: lightRecipe, defaults: defaultLightControls },
};
