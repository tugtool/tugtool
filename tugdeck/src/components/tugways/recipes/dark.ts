/**
 * Dark theme recipe — produces DerivationFormulas for dark mode themes.
 */

import type { ThemeSpec, DerivationFormulas } from "../theme-engine";

/**
 * Produces DerivationFormulas for a dark theme recipe.
 *
 * All fields are computed from recipe inputs via tone offsets and constants.
 * contentTextTone uses canvas+89 (a design intent offset → ~94, near-white)
 * rather than contrastSearch: the design calls for near-white text on dark
 * backgrounds, well above the minimum contrast-passing tone.
 */
export function darkRecipe(spec: ThemeSpec): DerivationFormulas {
  const canvasTone = spec.surface.canvas.tone;
  const canvasIntensity = spec.surface.canvas.intensity;
  const frameTone = spec.surface.frame.tone;
  const frameIntensity = spec.surface.frame.intensity;
  const cardBodyTone = spec.surface.card.tone;
  const cardBodyIntensity = spec.surface.card.intensity;
  const roleTone = spec.role.tone;
  const roleIntensity = spec.role.intensity;

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
    contentTextIntensity: spec.text.intensity,
    subtleTextIntensity: spec.text.intensity + 4,
    mutedTextIntensity: spec.text.intensity + 2,
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
    filledSurfaceRestTone: spec.role.tone,
    filledSurfaceHoverTone: Math.max(0, Math.min(100, spec.role.tone + 5)),
    filledSurfaceActiveTone: Math.max(0, Math.min(100, spec.role.tone + 10)),

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
