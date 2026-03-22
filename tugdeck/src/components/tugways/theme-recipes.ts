/**
 * Theme Recipes
 *
 * Recipe functions that produce DerivationFormulas from a ThemeRecipe.
 * Each recipe reads tone/intensity values from the recipe's surface, text,
 * and role specs, then computes all formula fields needed by the derivation
 * engine. Dark and light are independent recipes — no mode branching.
 *
 * - contrastSearch: binary search for a tone that meets a contrast threshold
 * - darkRecipe: produces formulas for dark themes
 * - lightRecipe: produces formulas for light themes
 * - RECIPE_REGISTRY: maps recipe name to function
 *
 * @module components/tugways/theme-recipes
 */

import { toneToL } from "./palette-engine";
import type { DerivationFormulas, ThemeRecipe } from "./theme-engine";

// ---------------------------------------------------------------------------
// contrastSearch
// ---------------------------------------------------------------------------

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
 * perceptual contrast against `surfaceTone`.
 *
 * Uses toneToL with the generic fallback (canonL=0.77) when hueName is omitted.
 * enforceContrastFloor in the engine provides hue-aware correction downstream,
 * so recipe-level results are approximate starting points that the safety net refines.
 *
 * @param surfaceTone - Surface tone (0-100)
 * @param threshold   - Required contrast magnitude (e.g. 75 for content role)
 * @param direction   - "lighter" | "darker" | "auto" (default "auto")
 *                      auto: dark surfaces (tone < 50) -> lighter; light surfaces -> darker
 * @param hueName     - Optional element hue name for more accurate L conversion
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

  const surfaceL = toneToL(surfaceTone);

  const extremeTone = resolvedDirection === "lighter" ? 100 : 0;
  const extremeL = toneToL(extremeTone, hueName);
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
    const midL = toneToL(mid, hueName);
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
// darkRecipe
// ---------------------------------------------------------------------------

/**
 * Produces DerivationFormulas for a dark theme recipe.
 *
 * All fields are computed from recipe inputs via tone offsets and constants.
 * contentTextTone uses canvas+89 (a design intent offset → ~94, near-white)
 * rather than contrastSearch: the design calls for near-white text on dark
 * backgrounds, well above the minimum contrast-passing tone.
 */
export function darkRecipe(recipe: ThemeRecipe): DerivationFormulas {
  const canvasTone = recipe.surface.canvas.tone;
  const canvasIntensity = recipe.surface.canvas.intensity;
  const frameTone = recipe.surface.frame.tone;
  const frameIntensity = recipe.surface.frame.intensity;
  const cardBodyTone = recipe.surface.card.tone;
  const cardBodyIntensity = recipe.surface.card.intensity;
  const roleTone = recipe.role.tone;
  const roleIntensity = recipe.role.intensity;

  // Design intent: near-white text on dark background (canvas+89 → ~94).
  // Using an offset rather than contrastSearch so the result is near-white,
  // not just minimum-passing contrast.
  const primaryTextTone = canvasTone + 89;

  return {
    // ===== Canvas Darkness =====
    surfaceAppTone: canvasTone,
    surfaceCanvasTone: canvasTone,

    // ===== Surface Layering =====
    surfaceSunkenTone: canvasTone + 6,
    surfaceDefaultTone: canvasTone + 7,
    surfaceRaisedTone: canvasTone + 6,
    surfaceOverlayTone: canvasTone + 9,
    surfaceInsetTone: canvasTone + 1,
    surfaceContentTone: canvasTone + 1,
    surfaceScreenTone: canvasTone + 11,

    // ===== Surface Coloring =====
    atmosphereIntensity: canvasIntensity,
    surfaceAppIntensity: 2,
    surfaceCanvasIntensity: 2,
    surfaceGridIntensity: 2,
    surfaceDefaultIntensity: 5,
    surfaceRaisedIntensity: 5,
    surfaceOverlayIntensity: 4,
    surfaceScreenIntensity: 7,
    surfaceInsetIntensity: 5,
    surfaceContentIntensity: 5,
    surfaceAppBaseIntensity: 2,
    cardBodyTone,
    cardBodyIntensity,

    // ===== Text Brightness =====
    contentTextTone: primaryTextTone,
    inverseTextTone: 100,

    // ===== Text Hierarchy =====
    mutedTextTone: primaryTextTone - 28,
    subtleTextTone: primaryTextTone - 57,
    disabledTextTone: primaryTextTone - 71,
    placeholderTextTone: primaryTextTone - 64,

    // ===== Text Coloring =====
    contentTextIntensity: recipe.text.intensity,
    subtleTextIntensity: recipe.text.intensity + 4,
    mutedTextIntensity: recipe.text.intensity + 2,
    atmosphereBorderIntensity: 6,
    inverseTextIntensity: 3,
    onCautionTextIntensity: 4,
    onSuccessTextIntensity: 4,

    // ===== Border Visibility =====
    borderBaseIntensity: 6,
    borderStrongIntensity: 7,
    borderMutedTone: primaryTextTone - 57,
    borderMutedIntensity: 7,
    // borderStrongTone sits slightly above muted to create a visible step
    borderStrongTone: primaryTextTone - 54,
    dividerDefaultIntensity: 6,
    dividerMutedIntensity: 4,
    borderRoleTone: roleTone,
    semanticRoleTone: roleTone,

    // ===== Card Frame Style =====
    cardFrameActiveIntensity: frameIntensity,
    cardFrameActiveTone: frameTone,
    cardFrameInactiveIntensity: 4,
    cardFrameInactiveTone: frameTone - 1,

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
    filledSurfaceRestTone: recipe.role.tone,
    filledSurfaceHoverTone: Math.max(0, Math.min(100, recipe.role.tone + 5)),
    filledSurfaceActiveTone: Math.max(0, Math.min(100, recipe.role.tone + 10)),

    // ===== Outlined Control Style =====
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
    outlinedOptionBorderRestTone: roleTone,
    outlinedOptionBorderHoverTone: roleTone + 5,
    outlinedOptionBorderActiveTone: roleTone + 10,
    outlinedSurfaceHoverIntensity: 0,
    outlinedSurfaceHoverAlpha: 10,
    outlinedSurfaceActiveIntensity: 0,
    outlinedSurfaceActiveAlpha: 20,

    // ===== Ghost Control Style =====
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
    ghostBorderTone: canvasTone + 55,
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
    badgeTintedTextIntensity: 72,
    badgeTintedTextTone: primaryTextTone - 9,
    badgeTintedSurfaceIntensity: 65,
    badgeTintedSurfaceTone: canvasTone + 55,
    badgeTintedSurfaceAlpha: 15,
    badgeTintedBorderIntensity: 50,
    badgeTintedBorderTone: roleTone,
    badgeTintedBorderAlpha: 35,

    // ===== Icon Style =====
    // iconActiveTone is vivid but below primaryTextTone to avoid blending with text
    iconActiveTone: primaryTextTone - 14,
    iconMutedIntensity: 7,
    iconMutedTone: primaryTextTone - 57,

    // ===== Tab Style =====
    tabTextActiveTone: primaryTextTone - 4,

    // ===== Toggle Style =====
    toggleTrackOnHoverTone: canvasTone + 40,
    toggleThumbDisabledTone: canvasTone + 35,
    toggleTrackDisabledIntensity: 5,

    // ===== Field Style =====
    fieldSurfaceRestTone: canvasTone + 3,
    fieldSurfaceHoverTone: canvasTone + 6,
    fieldSurfaceFocusTone: canvasTone + 2,
    fieldSurfaceDisabledTone: canvasTone + 1,
    fieldSurfaceReadOnlyTone: canvasTone + 6,
    fieldSurfaceRestIntensity: 5,
    disabledSurfaceIntensity: 5,
    disabledBorderIntensity: 6,

    // ===== Signal / Accent Tones =====
    // Kept darker (canvas+25) so fg-default achieves contrast >=75 against these surfaces
    accentSubtleTone: canvasTone + 25,
    cautionSurfaceTone: canvasTone + 25,

    // ===== Hue Slot Dispatch =====
    surfaceAppHueSlot: "canvas",
    surfaceCanvasHueSlot: "canvas",
    surfaceGridHueSlot: "canvas",
    surfaceSunkenHueSlot: "canvasBase",
    surfaceDefaultHueSlot: "canvasBase",
    surfaceRaisedHueSlot: "frame",
    surfaceOverlayHueSlot: "canvasBase",
    surfaceInsetHueSlot: "frame",
    surfaceContentHueSlot: "frame",
    surfaceScreenHueSlot: "canvasScreen",
    mutedTextHueSlot: "textMuted",
    subtleTextHueSlot: "textSubtle",
    disabledTextHueSlot: "textDisabled",
    placeholderTextHueSlot: "textPlaceholder",
    inverseTextHueSlot: "textInverse",
    onAccentTextHueSlot: "textInverse",
    iconMutedHueSlot: "textSubtle",
    iconOnAccentHueSlot: "textInverse",
    dividerMutedHueSlot: "borderBase",
    disabledSurfaceHueSlot: "canvasBase",
    fieldSurfaceHoverHueSlot: "canvasBase",
    fieldSurfaceReadOnlyHueSlot: "canvasBase",
    fieldPlaceholderHueSlot: "textPlaceholder",
    fieldBorderRestHueSlot: "textPlaceholder",
    fieldBorderHoverHueSlot: "textSubtle",
    toggleTrackDisabledHueSlot: "canvasBase",
    toggleThumbHueSlot: "textInverse",
    checkmarkHueSlot: "textInverse",
    radioDotHueSlot: "textInverse",
    tabSurfaceActiveHueSlot: "frame",
    tabSurfaceInactiveHueSlot: "frame",
    surfaceCardBodyHueSlot: "card",

    // ===== Sentinel Hue Dispatch =====
    outlinedSurfaceHoverHueSlot: "highlight",
    outlinedSurfaceActiveHueSlot: "highlight",
    ghostActionSurfaceHoverHueSlot: "highlight",
    ghostActionSurfaceActiveHueSlot: "highlight",
    ghostOptionSurfaceHoverHueSlot: "highlight",
    ghostOptionSurfaceActiveHueSlot: "highlight",
    tabSurfaceHoverHueSlot: "highlight",
    tabCloseSurfaceHoverHueSlot: "highlight",
    highlightHoverHueSlot: "highlightVerbose",

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
    disabledTextToneComputed: primaryTextTone - 56,
    disabledBorderToneOverride: canvasTone + 23,
    toggleTrackOffToneOverride: canvasTone + 23,
    toggleDisabledToneOverride: canvasTone + 17,
    borderStrongToneComputed: Math.round(primaryTextTone - 57),

    // ===== Computed Surface Tones =====
    surfaceApp: canvasTone,
    surfaceCanvas: canvasTone,
    surfaceGrid: canvasTone + 3,
    surfaceSunken: canvasTone + 6,
    surfaceDefault: canvasTone + 7,
    surfaceRaised: canvasTone + 6,
    surfaceOverlay: canvasTone + 9,
    surfaceInset: canvasTone + 1,
    surfaceContent: canvasTone + 1,
    surfaceScreen: canvasTone + 11,
    surfaceCardBody: cardBodyTone,

    // ===== Computed Divider Tones =====
    dividerDefault: canvasTone + 12,
    dividerMuted: canvasTone + 10,

    // ===== Computed Control Tones =====
    disabledSurfaceTone: canvasTone + 17,
    disabledBorderTone: canvasTone + 23,
    outlinedSurfaceRestTone: canvasTone + 3,
    outlinedSurfaceHoverTone: canvasTone + 7,
    outlinedSurfaceActiveTone: canvasTone + 9,
    toggleTrackOffTone: canvasTone + 23,
    toggleDisabledTone: canvasTone + 17,

    // ===== Computed Signal Intensity =====
    roleIntensity: Math.round(roleIntensity),

    // ===== Hue Name Dispatch =====
    surfaceScreenHueExpression: "indigo",
    mutedTextHueExpression: "barePrimary",
    subtleTextHueExpression: "indigo-cobalt",
    disabledTextHueExpression: "indigo-cobalt",
    inverseTextHueExpression: "sapphire-cobalt",
    placeholderTextHueExpression: "textMuted",
    selectionInactiveHueExpression: "yellow",

    // ===== Selection Mode =====
    selectionInactiveSemanticMode: true,
    selectionSurfaceInactiveIntensity: 0,
    selectionSurfaceInactiveTone: canvasTone + 25,
    selectionSurfaceInactiveAlpha: 25,

    // ===== Signal Intensity Value =====
    roleIntensityValue: roleIntensity,
  };
}

// ---------------------------------------------------------------------------
// lightRecipe
// ---------------------------------------------------------------------------

/**
 * Produces DerivationFormulas for a light theme recipe.
 *
 * Independent from darkRecipe — not derived by inverting parameters.
 * Surfaces descend from near-white (~95); text ascends from near-black (~8).
 * contentTextTone uses canvas-87 (a design intent offset → ~8) rather than
 * contrastSearch: the design calls for near-black text on light backgrounds.
 */
export function lightRecipe(recipe: ThemeRecipe): DerivationFormulas {
  const canvasTone = recipe.surface.canvas.tone;
  const canvasIntensity = recipe.surface.canvas.intensity;
  const frameTone = recipe.surface.frame.tone;
  const frameIntensity = recipe.surface.frame.intensity;
  const cardBodyTone = recipe.surface.card.tone;
  const cardBodyIntensity = recipe.surface.card.intensity;
  const roleTone = recipe.role.tone;
  const roleIntensity = recipe.role.intensity;

  // Design intent: near-black text on light background (canvas-87 → ~8).
  const primaryTextTone = canvasTone - 87;

  return {
    // ===== Canvas Darkness =====
    surfaceAppTone: canvasTone,
    surfaceCanvasTone: canvasTone,

    // ===== Surface Layering =====
    surfaceSunkenTone: canvasTone - 7,
    surfaceDefaultTone: canvasTone - 5,
    surfaceRaisedTone: canvasTone - 3,
    surfaceOverlayTone: canvasTone - 2,
    surfaceInsetTone: canvasTone - 9,
    surfaceContentTone: canvasTone - 9,
    surfaceScreenTone: canvasTone - 10,

    // ===== Surface Coloring =====
    atmosphereIntensity: canvasIntensity,
    surfaceAppIntensity: 3,
    surfaceCanvasIntensity: 3,
    surfaceGridIntensity: 2,
    surfaceDefaultIntensity: 6,
    surfaceRaisedIntensity: 6,
    surfaceOverlayIntensity: 5,
    surfaceScreenIntensity: 8,
    surfaceInsetIntensity: 6,
    surfaceContentIntensity: 6,
    surfaceAppBaseIntensity: 3,
    cardBodyTone,
    cardBodyIntensity,

    // ===== Text Brightness =====
    contentTextTone: primaryTextTone,
    inverseTextTone: 94,

    // ===== Text Hierarchy =====
    mutedTextTone: primaryTextTone + 26,
    subtleTextTone: primaryTextTone + 44,
    disabledTextTone: primaryTextTone + 60,
    placeholderTextTone: primaryTextTone + 52,

    // ===== Text Coloring =====
    contentTextIntensity: recipe.text.intensity,
    subtleTextIntensity: recipe.text.intensity + 4,
    mutedTextIntensity: recipe.text.intensity + 2,
    atmosphereBorderIntensity: 7,
    inverseTextIntensity: 3,
    onCautionTextIntensity: 5,
    onSuccessTextIntensity: 5,

    // ===== Border Visibility =====
    borderBaseIntensity: 8,
    borderStrongIntensity: 10,
    borderMutedTone: primaryTextTone + 54,
    borderMutedIntensity: 8,
    // borderStrongTone aligns with subtleTextTone to match hierarchy
    borderStrongTone: primaryTextTone + 44,
    dividerDefaultIntensity: 7,
    dividerMutedIntensity: 5,
    // borderRoleTone is shifted darker on light backgrounds to maintain role contrast
    borderRoleTone: canvasTone - 55,
    semanticRoleTone: canvasTone - 60,

    // ===== Card Frame Style =====
    cardFrameActiveIntensity: frameIntensity,
    cardFrameActiveTone: frameTone,
    cardFrameInactiveIntensity: 5,
    cardFrameInactiveTone: canvasTone - 5,

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
    // Light mode darkens on hover/active (negative offsets)
    filledSurfaceRestTone: recipe.role.tone,
    filledSurfaceHoverTone: Math.max(0, Math.min(100, recipe.role.tone - 5)),
    filledSurfaceActiveTone: Math.max(0, Math.min(100, recipe.role.tone - 10)),

    // ===== Outlined Control Style =====
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
    outlinedOptionBorderRestTone: roleTone,
    outlinedOptionBorderHoverTone: roleTone + 5,
    outlinedOptionBorderActiveTone: roleTone + 10,
    // Light mode: direct chroma path, fully opaque
    outlinedSurfaceHoverIntensity: 4,
    outlinedSurfaceHoverAlpha: 100,
    outlinedSurfaceActiveIntensity: 6,
    outlinedSurfaceActiveAlpha: 100,

    // ===== Ghost Control Style =====
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
    ghostBorderTone: canvasTone - 60,
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
    badgeTintedTextIntensity: 72,
    badgeTintedTextTone: primaryTextTone + 7,
    badgeTintedSurfaceIntensity: 65,
    badgeTintedSurfaceTone: canvasTone - 15,
    badgeTintedSurfaceAlpha: 20,
    badgeTintedBorderIntensity: 50,
    badgeTintedBorderTone: canvasTone - 55,
    badgeTintedBorderAlpha: 40,

    // ===== Icon Style =====
    // iconActiveTone is vivid but below primaryTextTone to avoid blending with text
    iconActiveTone: primaryTextTone + 12,
    iconMutedIntensity: 7,
    iconMutedTone: primaryTextTone + 44,

    // ===== Tab Style =====
    tabTextActiveTone: primaryTextTone + 2,

    // ===== Toggle Style =====
    toggleTrackOnHoverTone: canvasTone - 60,
    toggleThumbDisabledTone: canvasTone - 30,
    toggleTrackDisabledIntensity: 5,

    // ===== Field Style =====
    fieldSurfaceRestTone: canvasTone - 4,
    fieldSurfaceHoverTone: canvasTone - 7,
    fieldSurfaceFocusTone: canvasTone - 3,
    fieldSurfaceDisabledTone: canvasTone - 1,
    fieldSurfaceReadOnlyTone: canvasTone - 7,
    fieldSurfaceRestIntensity: 5,
    disabledSurfaceIntensity: 4,
    disabledBorderIntensity: 6,

    // ===== Signal / Accent Tones =====
    accentSubtleTone: roleTone,
    // cautionSurfaceTone aligns with semanticRoleTone to maintain role-color contrast
    cautionSurfaceTone: canvasTone - 60,

    // ===== Hue Slot Dispatch =====
    surfaceAppHueSlot: "canvas",
    surfaceCanvasHueSlot: "canvas",
    surfaceGridHueSlot: "canvas",
    surfaceSunkenHueSlot: "canvasBase",
    surfaceDefaultHueSlot: "canvasBase",
    surfaceRaisedHueSlot: "frame",
    surfaceOverlayHueSlot: "canvasBase",
    surfaceInsetHueSlot: "frame",
    surfaceContentHueSlot: "frame",
    surfaceScreenHueSlot: "canvasScreen",
    mutedTextHueSlot: "textMuted",
    subtleTextHueSlot: "textSubtle",
    disabledTextHueSlot: "textDisabled",
    placeholderTextHueSlot: "textPlaceholder",
    inverseTextHueSlot: "textInverse",
    onAccentTextHueSlot: "textInverse",
    iconMutedHueSlot: "textSubtle",
    iconOnAccentHueSlot: "textInverse",
    dividerMutedHueSlot: "borderBase",
    disabledSurfaceHueSlot: "canvasBase",
    fieldSurfaceHoverHueSlot: "canvasBase",
    fieldSurfaceReadOnlyHueSlot: "canvasBase",
    fieldPlaceholderHueSlot: "textPlaceholder",
    fieldBorderRestHueSlot: "textPlaceholder",
    fieldBorderHoverHueSlot: "textSubtle",
    toggleTrackDisabledHueSlot: "canvasBase",
    toggleThumbHueSlot: "textInverse",
    checkmarkHueSlot: "textInverse",
    radioDotHueSlot: "textInverse",
    tabSurfaceActiveHueSlot: "frame",
    tabSurfaceInactiveHueSlot: "frame",
    surfaceCardBodyHueSlot: "card",

    // ===== Sentinel Hue Dispatch =====
    outlinedSurfaceHoverHueSlot: "highlight",
    outlinedSurfaceActiveHueSlot: "highlight",
    ghostActionSurfaceHoverHueSlot: "highlight",
    ghostActionSurfaceActiveHueSlot: "highlight",
    ghostOptionSurfaceHoverHueSlot: "highlight",
    ghostOptionSurfaceActiveHueSlot: "highlight",
    tabSurfaceHoverHueSlot: "highlight",
    tabCloseSurfaceHoverHueSlot: "highlight",
    highlightHoverHueSlot: "highlightVerbose",

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
    disabledTextToneComputed: primaryTextTone + 54,
    disabledBorderToneOverride: canvasTone - 23,
    toggleTrackOffToneOverride: canvasTone - 23,
    toggleDisabledToneOverride: canvasTone - 15,
    borderStrongToneComputed: canvasTone - 55,

    // ===== Computed Surface Tones =====
    surfaceApp: canvasTone,
    surfaceCanvas: canvasTone,
    surfaceGrid: canvasTone - 3,
    surfaceSunken: canvasTone - 7,
    surfaceDefault: canvasTone - 5,
    surfaceRaised: canvasTone - 3,
    surfaceOverlay: canvasTone - 2,
    surfaceInset: canvasTone - 9,
    surfaceContent: canvasTone - 9,
    surfaceScreen: canvasTone - 10,
    surfaceCardBody: cardBodyTone,

    // ===== Computed Divider Tones =====
    dividerDefault: canvasTone - 17,
    dividerMuted: canvasTone - 13,

    // ===== Computed Control Tones =====
    disabledSurfaceTone: canvasTone - 17,
    disabledBorderTone: canvasTone - 23,
    outlinedSurfaceRestTone: canvasTone - 7,
    outlinedSurfaceHoverTone: canvasTone - 2,
    outlinedSurfaceActiveTone: canvasTone - 2,
    toggleTrackOffTone: canvasTone - 23,
    toggleDisabledTone: canvasTone - 15,

    // ===== Computed Signal Intensity =====
    roleIntensity: Math.round(roleIntensity),

    // ===== Hue Name Dispatch =====
    // Light mode uses cobalt screen bg and frame placeholder (dark mode uses indigo and textMuted)
    surfaceScreenHueExpression: "cobalt",
    mutedTextHueExpression: "barePrimary",
    subtleTextHueExpression: "indigo-cobalt",
    disabledTextHueExpression: "indigo-cobalt",
    inverseTextHueExpression: "sapphire-cobalt",
    placeholderTextHueExpression: "frame",
    selectionInactiveHueExpression: "yellow",

    // ===== Selection Mode =====
    selectionInactiveSemanticMode: false,
    selectionSurfaceInactiveIntensity: 8,
    selectionSurfaceInactiveTone: canvasTone - 15,
    selectionSurfaceInactiveAlpha: 30,

    // ===== Signal Intensity Value =====
    roleIntensityValue: roleIntensity,
  };
}

// ---------------------------------------------------------------------------
// RECIPE_REGISTRY
// ---------------------------------------------------------------------------

/**
 * Built-in recipe registry. Maps recipe name to its recipe function.
 * Used by deriveTheme() to produce DerivationFormulas.
 */
export const RECIPE_REGISTRY: Record<string, { fn: (recipe: ThemeRecipe) => DerivationFormulas }> = {
  dark: { fn: darkRecipe },
  light: { fn: lightRecipe },
};
