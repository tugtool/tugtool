/**
 * Recipe Functions — Theme Recipe Function System
 *
 * Provides recipe functions that express design relationships via rules
 * and `contrastSearch`, replacing the bag-of-constants approach of
 * DARK_FORMULAS / LIGHT_FORMULAS. [D01]
 *
 * Architecture:
 *   - `contrastSearch` — binary search in tone space for a contrast threshold (Spec S02)
 *   - `darkRecipe` — dark theme: rules + contrastSearch calls -> DerivationFormulas
 *   - `lightRecipe` — light theme: independent rules, not derived from dark (D03)
 *   - `RECIPE_REGISTRY` — map of recipe name -> fn (Spec S03)
 *
 * `contrastSearch` uses `toneToL` with the generic fallback (DEFAULT_CANONICAL_L lookup
 * returning 0.77 when hueName is omitted). The downstream `enforceContrastFloor` in
 * `evaluateRules` provides exact hue-aware correction, so recipe-level search results
 * are approximate starting points that the safety net refines. [D02]
 *
 * References: [D01] Recipe functions replace constant bags, [D02] contrastSearch is
 * a clean implementation, [D03] Light recipe is independent, Spec S02, Spec S03,
 * (#contrast-search-spec, #recipe-registry)
 *
 * @module components/tugways/recipe-functions
 */

import { DEFAULT_CANONICAL_L, L_DARK, L_LIGHT } from "./palette-engine";
import type { DerivationFormulas, ThemeRecipe } from "./theme-engine";

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
 * Dark theme recipe function. [D01]
 *
 * Rules are expressed as offsets + contrastSearch calls + constants.
 * Pre-computed tone fields (surfaceApp, roleIntensity, etc.) are set directly
 * by this function. [D04]
 *
 * Derived from DARK_FORMULAS offset analysis via compute-offsets.ts [D07]:
 *   canvasTone = 5 (base)
 *   surface tiers: +1 to +11 above canvas
 *   text: canvas+89 for primary (near-white design intent), -28/-57/-71 offsets for hierarchy
 *   frame: frameTone=16 / frameIntensity=12
 *   roles: roleTone=50 for filled controls and role tones
 *
 * Note: contentTextTone uses canvas+89 (a design intent offset) rather than
 * contrastSearch, because the design calls for near-white (tone~94) text on dark
 * backgrounds — significantly above the minimum contrast-passing tone (~58).
 * contrastSearch is used for frameTone-relative values and roles where
 * the minimum-passing tone is the right choice.
 */
export function darkRecipe(recipe: ThemeRecipe): DerivationFormulas {
  const c = recipe.surface.canvas.tone; // canvasTone from recipe
  const canvasIntensity = recipe.surface.canvas.intensity;
  const frameTone = recipe.surface.frame.tone;
  const frameIntensity = recipe.surface.frame.intensity;
  const cardBodyTone = recipe.surface.card.tone;
  const cardBodyIntensity = recipe.surface.card.intensity;
  const roleTone = recipe.role.tone;
  const roleIntensity = recipe.role.intensity;

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
    atmosphereIntensity: canvasIntensity,
    surfaceAppIntensity: 2,
    surfaceCanvasIntensity: 2,
    surfaceGridIntensity: 2, // very subtle: barely visible grid line on canvas
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
    // borderMutedTone=37 (matches subtleTextTone: primaryTextTone−57)
    borderMutedTone: primaryTextTone - 57,
    borderMutedIntensity: 7,
    // borderStrongTone=40 (slightly above muted: primaryTextTone−54)
    borderStrongTone: primaryTextTone - 54,
    dividerDefaultIntensity: 6,
    dividerMutedIntensity: 4,
    borderRoleTone: roleTone, // role borders use role tone
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
    // Dark mode: rest = recipe.role.tone, hover/active are clamped offsets per D03
    filledSurfaceRestTone: recipe.role.tone,
    filledSurfaceHoverTone: Math.max(0, Math.min(100, recipe.role.tone + 5)),
    filledSurfaceActiveTone: Math.max(0, Math.min(100, recipe.role.tone + 10)),

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
    outlinedOptionBorderRestTone: roleTone,
    outlinedOptionBorderHoverTone: roleTone + 5,
    outlinedOptionBorderActiveTone: roleTone + 10,
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
    badgeTintedBorderTone: roleTone, // 50
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
    surfaceGridHueSlot: "canvas", // grid line uses the canvas hue at a slightly offset tone
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
    tabSurfaceActiveHueSlot: "frame",
    tabSurfaceInactiveHueSlot: "frame",
    surfaceCardBodyHueSlot: "card",

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

    // ===== Legacy passthrough fields (retained for schema compatibility) =====
    surfaceCanvasToneBase: c,
    surfaceCanvasToneCenter: 50,
    surfaceCanvasToneScale: 8,
    disabledSurfaceToneBase: c + 17,
    disabledSurfaceToneScale: 0,

    // ===== Computed Surface Tones =====
    // Directly assigned by recipe function. Read by Expr lambdas in derivation-rules.ts. [D04]
    // At surfaceContrast=50, all surface tones equal their input tone fields.
    surfaceApp: c,
    surfaceCanvas: c,
    surfaceGrid: c + 3, // dark mode: slightly lighter than canvas (+3) for a barely visible grid line
    surfaceSunken: c + 6,
    surfaceDefault: c + 7,
    surfaceRaised: c + 6,
    surfaceOverlay: c + 9,
    surfaceInset: c + 1,
    surfaceContent: c + 1,
    surfaceScreen: c + 11,
    surfaceCardBody: cardBodyTone,

    // ===== Computed Divider Tones =====
    dividerDefault: c + 12,
    dividerMuted: c + 10,
    dividerTone: c + 12, // = dividerDefault

    // ===== Computed Control Tones =====
    disabledSurfaceTone: c + 17,
    disabledBorderTone: c + 23,
    outlinedSurfaceRestTone: c + 3,  // surfaceInset + 2 = (c+1) + 2 = c+3 → dark: 8
    outlinedSurfaceHoverTone: c + 7,  // surfaceRaised + 1 = (c+6) + 1 = c+7 → dark: 12
    outlinedSurfaceActiveTone: c + 9, // surfaceOverlay = c+9 → dark: 14
    toggleTrackOffTone: c + 23,
    toggleDisabledTone: c + 17, // = disabledSurfaceTone

    // ===== Computed Signal Intensity =====
    roleIntensity: Math.round(roleIntensity),

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
    roleIntensityValue: roleIntensity,
  };
}

// ---------------------------------------------------------------------------
// lightRecipe — Light theme recipe function [D01] [D03]
// ---------------------------------------------------------------------------

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
 *   frame: frameTone=85 / frameIntensity=35
 *
 * Note: contentTextTone uses canvas-87 (a design intent offset → ~8) rather than
 * contrastSearch, because the design calls for near-black text on light backgrounds.
 */
export function lightRecipe(recipe: ThemeRecipe): DerivationFormulas {
  const c = recipe.surface.canvas.tone; // canvasTone from recipe
  const canvasIntensity = recipe.surface.canvas.intensity;
  const frameTone = recipe.surface.frame.tone;
  const frameIntensity = recipe.surface.frame.intensity;
  const cardBodyTone = recipe.surface.card.tone;
  const cardBodyIntensity = recipe.surface.card.intensity;
  const roleTone = recipe.role.tone;
  const roleIntensity = recipe.role.intensity;

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
    atmosphereIntensity: canvasIntensity,
    surfaceAppIntensity: 3,
    surfaceCanvasIntensity: 3,
    surfaceGridIntensity: 2, // very subtle: barely visible grid line on canvas
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
    // borderMutedTone=62 (primaryTextTone+54), borderStrongTone=52 (primaryTextTone+44=subtleTextTone)
    borderMutedTone: primaryTextTone + 54,
    borderMutedIntensity: 8,
    borderStrongTone: primaryTextTone + 44, // matches subtleTextTone: 52
    dividerDefaultIntensity: 7,
    dividerMutedIntensity: 5,
    borderRoleTone: c - 55, // 40 in LIGHT_FORMULAS: darker role tones on light bg
    semanticRoleTone: c - 60, // 35 in LIGHT_FORMULAS

    // ===== Card Frame Style =====
    cardFrameActiveIntensity: frameIntensity,
    cardFrameActiveTone: frameTone,
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
    // Light mode: rest = recipe.role.tone, hover/active are clamped offsets per D03
    // Light mode darkens on hover/active, so offsets are negative.
    filledSurfaceRestTone: recipe.role.tone,
    filledSurfaceHoverTone: Math.max(0, Math.min(100, recipe.role.tone - 5)),
    filledSurfaceActiveTone: Math.max(0, Math.min(100, recipe.role.tone - 10)),

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
    outlinedOptionBorderRestTone: roleTone, // 50
    outlinedOptionBorderHoverTone: roleTone + 5, // 55
    outlinedOptionBorderActiveTone: roleTone + 10, // 60
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
    badgeTintedBorderTone: c - 55, // matches borderRoleTone: 40
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
    accentSubtleTone: roleTone, // 50 in LIGHT_FORMULAS
    cautionSurfaceTone: c - 60, // 35 in LIGHT_FORMULAS: matches semanticRoleTone

    // ===== Hue Slot Dispatch =====
    // Mode-independent routing (same as DARK_FORMULAS)
    surfaceAppHueSlot: "canvas",
    surfaceCanvasHueSlot: "canvas",
    surfaceGridHueSlot: "canvas", // grid line uses the canvas hue at a slightly offset tone
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
    tabSurfaceActiveHueSlot: "frame",
    tabSurfaceInactiveHueSlot: "frame",
    surfaceCardBodyHueSlot: "card",

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
    borderStrongToneComputed: c - 55, // 40 in LIGHT_FORMULAS: matches borderRoleTone

    // ===== Legacy passthrough fields (retained for schema compatibility) =====
    surfaceCanvasToneBase: c,
    surfaceCanvasToneCenter: 50,
    surfaceCanvasToneScale: 8,
    disabledSurfaceToneBase: c - 17, // 78 in LIGHT_FORMULAS
    disabledSurfaceToneScale: 0,

    // ===== Computed Surface Tones =====
    // Directly assigned by recipe function. Read by Expr lambdas in derivation-rules.ts. [D04]
    surfaceApp: c,
    surfaceCanvas: c,
    surfaceGrid: c - 3, // light mode: slightly darker than canvas (-3) for a barely visible grid line
    surfaceSunken: c - 7,  // 88 in LIGHT_FORMULAS
    surfaceDefault: c - 5, // 90 in LIGHT_FORMULAS
    surfaceRaised: c - 3,  // 92 in LIGHT_FORMULAS
    surfaceOverlay: c - 2, // 93 in LIGHT_FORMULAS
    surfaceInset: c - 9,   // 86 in LIGHT_FORMULAS
    surfaceContent: c - 9, // 86 in LIGHT_FORMULAS (matches inset)
    surfaceScreen: c - 10, // 85 in LIGHT_FORMULAS
    surfaceCardBody: cardBodyTone,

    // ===== Computed Divider Tones =====
    dividerDefault: c - 17, // 78 in LIGHT_FORMULAS
    dividerMuted: c - 13,   // 82 in LIGHT_FORMULAS
    dividerTone: c - 17,    // = dividerDefault = 78

    // ===== Computed Control Tones =====
    disabledSurfaceTone: c - 17, // 78 in LIGHT_FORMULAS (= disabledSurfaceToneBase at sc=50, scale=0)
    disabledBorderTone: c - 23,  // 72 in LIGHT_FORMULAS
    outlinedSurfaceRestTone: c - 7,  // surfaceInset + 2 = (c-9) + 2 = c-7 → 88
    outlinedSurfaceHoverTone: c - 2, // surfaceRaised + 1 = (c-3) + 1 = c-2 → 93
    outlinedSurfaceActiveTone: c - 2, // surfaceOverlay = c-2 → 93
    toggleTrackOffTone: c - 23,  // 72 in LIGHT_FORMULAS
    toggleDisabledTone: c - 15,  // 80 in LIGHT_FORMULAS

    // ===== Computed Signal Intensity =====
    roleIntensity: Math.round(roleIntensity),

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
    roleIntensityValue: roleIntensity,
  };
}

// ---------------------------------------------------------------------------
// RECIPE_REGISTRY — Spec S03
// ---------------------------------------------------------------------------

/**
 * Built-in recipe registry. Maps recipe name to its recipe function.
 * Used by deriveTheme() to produce DerivationFormulas. (Spec S03)
 */
export const RECIPE_REGISTRY: Record<string, { fn: (recipe: ThemeRecipe) => DerivationFormulas }> = {
  dark: { fn: darkRecipe },
  light: { fn: lightRecipe },
};
