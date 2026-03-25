/**
 * Light theme recipe — produces DerivationFormulas for light mode themes.
 */

import type { ThemeSpec, DerivationFormulas } from "../theme-engine";

/**
 * Produces DerivationFormulas for a light theme recipe.
 *
 * Surfaces descend from near-white (~95); text ascends from near-black (~8).
 * contentTextTone uses canvas-87 (a design intent offset → ~8) rather than
 * contrastSearch: the design calls for near-black text on light backgrounds.
 */
export function lightRecipe(spec: ThemeSpec): DerivationFormulas {
  const canvasTone = spec.surface.canvas.tone;
  const canvasIntensity = spec.surface.canvas.intensity;
  const frameTone = spec.surface.frame.tone;
  const frameIntensity = spec.surface.frame.intensity;
  const cardBodyTone = spec.surface.card.tone;
  const cardBodyIntensity = spec.surface.card.intensity;
  const roleTone = spec.role.tone;
  const roleIntensity = spec.role.intensity;

  // Base tone: the reference lightness for all content-area formulas.
  // Defaults to canvasTone, so existing themes (harmony) are unchanged.
  // Set surface.base in the theme JSON to decouple the canvas background
  // from content-area derivations (e.g., dark canvas with light content).
  const baseTone = spec.surface.base ?? canvasTone;

  // Design intent: near-black text on light background (base-87 → ~8).
  const primaryTextTone = baseTone - 87;

  return {
    // ===== Canvas Darkness =====
    surfaceAppTone: canvasTone,
    surfaceCanvasTone: canvasTone,

    // ===== Surface Layering =====
    surfaceSunkenTone: baseTone - 7,
    surfaceDefaultTone: baseTone - 5,
    surfaceRaisedTone: baseTone - 3,
    surfaceOverlayTone: baseTone - 2,
    surfaceInsetTone: baseTone - 9,
    surfaceContentTone: baseTone - 9,
    surfaceScreenTone: baseTone - 10,

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
    contentTextIntensity: spec.text.intensity,
    subtleTextIntensity: spec.text.intensity + 4,
    mutedTextIntensity: spec.text.intensity + 2,
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
    borderRoleTone: baseTone - 55,
    semanticRoleTone: baseTone - 60,

    // ===== Card Frame Style =====
    cardFrameActiveIntensity: frameIntensity,
    cardFrameActiveTone: frameTone,
    cardFrameInactiveIntensity: 5,
    cardFrameInactiveTone: baseTone - 5,

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
    filledSurfaceRestTone: spec.role.tone,
    filledSurfaceHoverTone: Math.max(0, Math.min(100, spec.role.tone - 5)),
    filledSurfaceActiveTone: Math.max(0, Math.min(100, spec.role.tone - 10)),

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
    ghostBorderTone: baseTone - 60,
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
    badgeTintedSurfaceTone: baseTone - 15,
    badgeTintedSurfaceAlpha: 20,
    badgeTintedBorderIntensity: 50,
    badgeTintedBorderTone: baseTone - 55,
    badgeTintedBorderAlpha: 40,

    // ===== Icon Style =====
    // iconActiveTone is vivid but below primaryTextTone to avoid blending with text
    iconActiveTone: primaryTextTone + 12,
    iconMutedIntensity: 7,
    iconMutedTone: primaryTextTone + 44,

    // ===== Tab Style =====
    tabTextActiveTone: primaryTextTone + 2,

    // ===== Toggle Style =====
    toggleTrackOnHoverTone: baseTone - 60,
    toggleThumbDisabledTone: baseTone - 30,
    toggleTrackDisabledIntensity: 5,

    // ===== Field Style =====
    fieldSurfaceRestTone: baseTone - 4,
    fieldSurfaceHoverTone: baseTone - 7,
    fieldSurfaceFocusTone: baseTone - 3,
    fieldSurfaceDisabledTone: baseTone - 1,
    fieldSurfaceReadOnlyTone: baseTone - 7,
    fieldSurfaceRestIntensity: 5,
    disabledSurfaceIntensity: 4,
    disabledBorderIntensity: 6,

    // ===== Signal / Accent Tones =====
    accentSubtleTone: roleTone,
    // cautionSurfaceTone aligns with semanticRoleTone to maintain role-color contrast
    cautionSurfaceTone: baseTone - 60,

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
    ghostSurfaceHoverHueSlot: "highlight",
    ghostSurfaceActiveHueSlot: "highlight",
    tabSurfaceHoverHueSlot: "highlight",
    tabCloseSurfaceHoverHueSlot: "highlight",
    highlightHoverHueSlot: "highlightVerbose",

    // ===== Sentinel Alpha =====
    tabSurfaceHoverAlpha: 8,
    tabCloseSurfaceHoverAlpha: 12,
    ghostSurfaceHoverAlpha: 10,
    ghostSurfaceActiveAlpha: 20,
    highlightHoverAlpha: 5,

    // ===== Computed Tone Override =====
    disabledTextToneComputed: primaryTextTone + 54,
    disabledBorderToneOverride: baseTone - 23,
    toggleTrackOffToneOverride: baseTone - 23,
    toggleDisabledToneOverride: baseTone - 15,
    borderStrongToneComputed: baseTone - 55,

    // ===== Computed Surface Tones =====
    surfaceApp: canvasTone,
    surfaceCanvas: canvasTone,
    surfaceGrid: baseTone - 3,
    surfaceSunken: baseTone - 7,
    surfaceDefault: baseTone - 5,
    surfaceRaised: baseTone - 3,
    surfaceOverlay: baseTone - 2,
    surfaceInset: baseTone - 9,
    surfaceContent: baseTone - 9,
    surfaceScreen: baseTone - 10,
    surfaceCardBody: cardBodyTone,

    // ===== Computed Divider Tones =====
    dividerDefault: baseTone - 17,
    dividerMuted: baseTone - 13,

    // ===== Computed Control Tones =====
    disabledSurfaceTone: baseTone - 17,
    disabledBorderTone: baseTone - 23,
    outlinedSurfaceRestTone: baseTone - 7,
    outlinedSurfaceHoverTone: baseTone - 2,
    outlinedSurfaceActiveTone: baseTone - 2,
    toggleTrackOffTone: baseTone - 23,
    toggleDisabledTone: baseTone - 15,

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
    selectionSurfaceInactiveTone: baseTone - 15,
    selectionSurfaceInactiveAlpha: 30,

    // ===== Signal Intensity Value =====
    roleIntensityValue: roleIntensity,
  };
}
