/**
 * Derivation Rule Table — All Token Rules (Steps 5 and 6)
 *
 * Contains ChromaticRule, ShadowRule, HighlightRule, StructuralRule, and
 * InvariantRule entries for ALL 373 --tug-base-* tokens.
 *
 * Sections:
 *   A. Core Visual: surfaces, foreground, icon, borders/dividers,
 *      elevation/overlay, invariants (~90 tokens)
 *   B. Accent System (~3 tokens)
 *   C. Semantic Tones (accent, active, agent, data, success, caution, danger: ~35 tokens)
 *   D. Selection / Highlight / Preview (~9 tokens)
 *   D2. Tab Chrome (~9 tokens)
 *   E. Control Surfaces: filled, outlined, ghost, disabled, field, toggle,
 *      checkmark, separator (~207 tokens)
 *   F. Badge Tinted (~21 tokens)
 *
 * hueSlot names follow dual-path resolution [D09]:
 *   - Direct ResolvedHueSlots keys (e.g., "txt", "interactive", "accent") ->
 *     mode-independent, resolved directly from resolvedSlots.
 *   - Preset-mediated names (e.g., "bgApp", "surfaceSunken") ->
 *     preset[name + "HueSlot"] yields the actual ResolvedHueSlots key.
 * Sentinel values [D07]: "__white" | "__highlight" | "__shadow" | "__verboseHighlight"
 *
 * @module components/tugways/derivation-rules
 */

import type {
  DerivationRule,
} from "./theme-derivation-engine";

// ---------------------------------------------------------------------------
// Helpers for common intensity/tone patterns
// ---------------------------------------------------------------------------

/** Literal number expression: always returns the same value. */
function lit(n: number): () => number {
  return () => n;
}

// ---------------------------------------------------------------------------
// A. Core Visual — Surfaces
// ---------------------------------------------------------------------------

const SURFACE_RULES: Record<string, DerivationRule> = {
  // bg-app: hueSlot "bgApp" -> preset.bgAppHueSlot ("canvas" dark | "txt" light)
  "--tug-base-bg-app": {
    type: "chromatic",
    hueSlot: "bgApp",
    intensityExpr: (preset) => (preset.isLight ? preset.atmI : preset.bgAppI),
    toneExpr: (_p, _k, computed) => computed.bgApp,
  },

  // bg-canvas: hueSlot "bgCanvas" -> preset.bgCanvasHueSlot ("canvas" dark | "atm" light)
  "--tug-base-bg-canvas": {
    type: "chromatic",
    hueSlot: "bgCanvas",
    intensityExpr: (preset) => preset.bgCanvasI,
    toneExpr: (_p, _k, computed) => computed.bgCanvas,
  },

  // surface-sunken: hueSlot "surfaceSunken" -> "surfBareBase" dark | "atm" light
  "--tug-base-surface-sunken": {
    type: "chromatic",
    hueSlot: "surfaceSunken",
    intensityExpr: (preset) => preset.atmI,
    toneExpr: (_p, _k, computed) => computed.surfaceSunken,
  },

  // surface-default: hueSlot "surfaceDefault" -> "surfBareBase" dark | "atm" light
  "--tug-base-surface-default": {
    type: "chromatic",
    hueSlot: "surfaceDefault",
    intensityExpr: (preset) => preset.surfaceDefaultI,
    toneExpr: (_p, _k, computed) => computed.surfaceDefault,
  },

  // surface-raised: hueSlot "surfaceRaised" -> "atm" dark | "txt" light
  "--tug-base-surface-raised": {
    type: "chromatic",
    hueSlot: "surfaceRaised",
    intensityExpr: (preset) => preset.surfaceRaisedI,
    toneExpr: (_p, _k, computed) => computed.surfaceRaised,
  },

  // surface-overlay: hueSlot "surfaceOverlay" -> "surfBareBase" dark | "atm" light
  "--tug-base-surface-overlay": {
    type: "chromatic",
    hueSlot: "surfaceOverlay",
    intensityExpr: (preset) => preset.surfaceOverlayI,
    toneExpr: (_p, _k, computed) => computed.surfaceOverlay,
  },

  // surface-inset: hueSlot "surfaceInset" -> "atm" dark | "atm" light
  "--tug-base-surface-inset": {
    type: "chromatic",
    hueSlot: "surfaceInset",
    intensityExpr: (preset) => preset.surfaceInsetI,
    toneExpr: (_p, _k, computed) => computed.surfaceInset,
  },

  // surface-content: same hue slot as surface-inset, same tone
  "--tug-base-surface-content": {
    type: "chromatic",
    hueSlot: "surfaceContent",
    intensityExpr: (preset) => preset.surfaceContentI,
    toneExpr: (_p, _k, computed) => computed.surfaceContent,
  },

  // surface-screen: hueSlot "surfaceScreen" -> "surfScreen" dark | "txt" light
  "--tug-base-surface-screen": {
    type: "chromatic",
    hueSlot: "surfaceScreen",
    intensityExpr: (preset) => preset.surfaceScreenI,
    toneExpr: (_p, _k, computed) => computed.surfaceScreen,
  },
};

// ---------------------------------------------------------------------------
// A. Core Visual — Foreground / Text
// ---------------------------------------------------------------------------

const FOREGROUND_RULES: Record<string, DerivationRule> = {
  // fg-default: always txt hue (direct key)
  "--tug-base-fg-default": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.fgDefaultTone,
  },

  // fg-muted: hueSlot "fgMuted" -> "fgMuted" dark | "txt" light
  "--tug-base-fg-muted": {
    type: "chromatic",
    hueSlot: "fgMuted",
    intensityExpr: (preset) => preset.fgMutedI,
    toneExpr: (preset) => preset.fgMutedTone,
  },

  // fg-subtle: hueSlot "fgSubtle" -> "fgSubtle" dark | "txt" light
  "--tug-base-fg-subtle": {
    type: "chromatic",
    hueSlot: "fgSubtle",
    intensityExpr: (preset) => preset.txtISubtle,
    toneExpr: (preset) => preset.fgSubtleTone,
  },

  // fg-disabled: hueSlot "fgDisabled" -> "fgDisabled" dark | "txt" light
  "--tug-base-fg-disabled": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (preset) => preset.txtISubtle,
    toneExpr: (preset) => preset.fgDisabledTone,
  },

  // fg-inverse: hueSlot "fgInverse" -> "fgInverse" dark | "txt" light
  "--tug-base-fg-inverse": {
    type: "chromatic",
    hueSlot: "fgInverse",
    intensityExpr: (preset) => preset.fgInverseI,
    toneExpr: (preset) => preset.fgInverseTone,
  },

  // fg-placeholder: hueSlot "fgPlaceholder" -> "fgPlaceholder" dark | "atm" light
  "--tug-base-fg-placeholder": {
    type: "chromatic",
    hueSlot: "fgPlaceholder",
    intensityExpr: (preset) => preset.atmIBorder,
    toneExpr: (preset) => preset.fgPlaceholderTone,
  },

  // fg-link: interactive hue, canonical i:50 t:50 (direct key)
  "--tug-base-fg-link": {
    type: "chromatic",
    hueSlot: "interactive",
    intensityExpr: lit(50),
    toneExpr: lit(50),
  },

  // fg-link-hover: interactive hue, i:20 t:85 (= "cyan-light" preset)
  "--tug-base-fg-link-hover": {
    type: "chromatic",
    hueSlot: "interactive",
    intensityExpr: lit(20),
    toneExpr: lit(85),
  },

  // fg-onAccent: hueSlot "fgOnAccent" -> "fgInverse" dark | "__white" light
  "--tug-base-fg-onAccent": {
    type: "chromatic",
    hueSlot: "fgOnAccent",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.fgInverseTone,
  },

  // fg-onDanger: same as fg-onAccent
  "--tug-base-fg-onDanger": {
    type: "chromatic",
    hueSlot: "fgOnAccent",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.fgInverseTone,
  },

  // fg-onCaution: atm hue, i:4 dark | atmI light, t:7 (dark text on bright bg)
  "--tug-base-fg-onCaution": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (preset) => preset.fgOnCautionI,
    toneExpr: lit(7),
  },

  // fg-onSuccess: atm hue, i:4 dark | atmI light, t:7
  "--tug-base-fg-onSuccess": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (preset) => preset.fgOnSuccessI,
    toneExpr: lit(7),
  },
};

// ---------------------------------------------------------------------------
// A. Core Visual — Icon
// ---------------------------------------------------------------------------

const ICON_RULES: Record<string, DerivationRule> = {
  // icon-default: same as fg-muted
  "--tug-base-icon-default": {
    type: "chromatic",
    hueSlot: "fgMuted",
    intensityExpr: (preset) => preset.fgMutedI,
    toneExpr: (preset) => preset.fgMutedTone,
  },

  // icon-muted: hueSlot "iconMuted" -> "fgSubtle" dark | "atm" light
  // Dark: i=iconMutedI (7=txtISubtle), t=iconMutedTone (37=fgSubtleTone)
  // Light: i=iconMutedI (9=atmIBorder), t=iconMutedTone (28=fgPlaceholderTone)
  "--tug-base-icon-muted": {
    type: "chromatic",
    hueSlot: "iconMuted",
    intensityExpr: (preset) => preset.iconMutedI,
    toneExpr: (preset) => preset.iconMutedTone,
  },

  // icon-disabled: same as fg-disabled
  "--tug-base-icon-disabled": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (preset) => preset.txtISubtle,
    toneExpr: (preset) => preset.fgDisabledTone,
  },

  // icon-active: vivid txt hue, i:100, t:iconActiveTone
  "--tug-base-icon-active": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: lit(100),
    toneExpr: (preset) => preset.iconActiveTone,
  },

  // icon-onAccent: hueSlot "iconOnAccent" -> "fgInverse" dark | "__white" light
  "--tug-base-icon-onAccent": {
    type: "chromatic",
    hueSlot: "iconOnAccent",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.fgInverseTone,
  },
};

// ---------------------------------------------------------------------------
// A. Core Visual — Borders / Dividers
// ---------------------------------------------------------------------------

const BORDER_RULES: Record<string, DerivationRule> = {
  // border-default: borderTint hue at borderIBase, fgPlaceholderTone
  "--tug-base-border-default": {
    type: "chromatic",
    hueSlot: "borderTint",
    intensityExpr: (preset) => preset.borderIBase,
    toneExpr: (preset) => preset.fgPlaceholderTone,
  },

  // border-muted: borderTint hue at borderMutedI, borderMutedTone
  "--tug-base-border-muted": {
    type: "chromatic",
    hueSlot: "borderTint",
    intensityExpr: (preset) => preset.borderMutedI,
    toneExpr: (preset) => preset.borderMutedTone,
  },

  // border-strong: borderStrong hue (borderTint -5°) at borderIStrong, borderStrongTone
  "--tug-base-border-strong": {
    type: "chromatic",
    hueSlot: "borderStrong",
    intensityExpr: (preset) => preset.borderIStrong,
    toneExpr: (preset) => preset.borderStrongTone,
  },

  // border-inverse: txt hue at txtI, fgDefaultTone
  "--tug-base-border-inverse": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.fgDefaultTone,
  },

  // border-accent: accent hue at signalI, t:50 (direct key — mode-independent)
  "--tug-base-border-accent": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // border-danger: destructive hue at signalI, t:50 (direct key — mode-independent)
  "--tug-base-border-danger": {
    type: "chromatic",
    hueSlot: "destructive",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // divider-default: borderTint hue at dividerDefaultI, dividerDefault
  "--tug-base-divider-default": {
    type: "chromatic",
    hueSlot: "borderTint",
    intensityExpr: (preset) => preset.dividerDefaultI,
    toneExpr: (_p, _k, computed) => computed.dividerDefault,
  },

  // divider-muted: hueSlot "dividerMuted" -> "borderTintBareBase" dark | "borderTint" light
  "--tug-base-divider-muted": {
    type: "chromatic",
    hueSlot: "dividerMuted",
    intensityExpr: (preset) => preset.dividerMutedI,
    toneExpr: (_p, _k, computed) => computed.dividerMuted,
  },
};

// ---------------------------------------------------------------------------
// A. Core Visual — Elevation / Overlay
// ---------------------------------------------------------------------------

const ELEVATION_RULES: Record<string, DerivationRule> = {
  "--tug-base-shadow-xs": {
    type: "shadow",
    alphaExpr: (preset) => preset.shadowXsAlpha,
  },
  "--tug-base-shadow-md": {
    type: "shadow",
    alphaExpr: (preset) => preset.shadowMdAlpha,
  },
  "--tug-base-shadow-lg": {
    type: "shadow",
    alphaExpr: (preset) => preset.shadowLgAlpha,
  },
  "--tug-base-shadow-xl": {
    type: "shadow",
    alphaExpr: (preset) => preset.shadowXlAlpha,
  },

  // shadow-overlay: composite value "0 4px 16px --tug-color(black, ...)"
  // Uses StructuralRule with resolvedExpr so resolved map is populated.
  "--tug-base-shadow-overlay": {
    type: "structural",
    valueExpr: (preset) =>
      `0 4px 16px --tug-color(black, i: 0, t: 0, a: ${preset.shadowOverlayAlpha})`,
    resolvedExpr: (preset) => ({ L: 0, C: 0, h: 0, alpha: preset.shadowOverlayAlpha / 100 }),
  },

  "--tug-base-overlay-dim": {
    type: "shadow",
    alphaExpr: (preset) => preset.overlayDimAlpha,
  },
  "--tug-base-overlay-scrim": {
    type: "shadow",
    alphaExpr: (preset) => preset.overlayScrimAlpha,
  },

  // overlay-highlight: always verbose white form (i:0, t:100, a:N) per [D07] __verboseHighlight
  // Uses ChromaticRule with hueSlot "__verboseHighlight" (direct sentinel — not preset-mediated)
  "--tug-base-overlay-highlight": {
    type: "chromatic",
    hueSlot: "__verboseHighlight",
    intensityExpr: lit(0),
    toneExpr: lit(100),
    alphaExpr: (preset) => preset.overlayHighlightAlpha,
  },
};

// ---------------------------------------------------------------------------
// A. Core Visual — Invariants: typography, spacing, radius, chrome, icons, motion
// ---------------------------------------------------------------------------

const INVARIANT_RULES: Record<string, DerivationRule> = {
  // Typography
  "--tug-base-font-family-sans": { type: "invariant", value: '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif' },
  "--tug-base-font-family-mono": { type: "invariant", value: '"Hack", "JetBrains Mono", "SFMono-Regular", "Menlo", monospace' },
  "--tug-base-font-size-2xs": { type: "invariant", value: "11px" },
  "--tug-base-font-size-xs": { type: "invariant", value: "12px" },
  "--tug-base-font-size-sm": { type: "invariant", value: "13px" },
  "--tug-base-font-size-md": { type: "invariant", value: "14px" },
  "--tug-base-font-size-lg": { type: "invariant", value: "16px" },
  "--tug-base-font-size-xl": { type: "invariant", value: "20px" },
  "--tug-base-font-size-2xl": { type: "invariant", value: "24px" },
  "--tug-base-line-height-2xs": { type: "invariant", value: "15px" },
  "--tug-base-line-height-xs": { type: "invariant", value: "17px" },
  "--tug-base-line-height-sm": { type: "invariant", value: "19px" },
  "--tug-base-line-height-md": { type: "invariant", value: "20px" },
  "--tug-base-line-height-lg": { type: "invariant", value: "24px" },
  "--tug-base-line-height-xl": { type: "invariant", value: "28px" },
  "--tug-base-line-height-2xl": { type: "invariant", value: "32px" },
  "--tug-base-line-height-tight": { type: "invariant", value: "1.2" },
  "--tug-base-line-height-normal": { type: "invariant", value: "1.45" },
  // Spacing
  "--tug-base-space-2xs": { type: "invariant", value: "2px" },
  "--tug-base-space-xs": { type: "invariant", value: "4px" },
  "--tug-base-space-sm": { type: "invariant", value: "6px" },
  "--tug-base-space-md": { type: "invariant", value: "8px" },
  "--tug-base-space-lg": { type: "invariant", value: "12px" },
  "--tug-base-space-xl": { type: "invariant", value: "16px" },
  "--tug-base-space-2xl": { type: "invariant", value: "24px" },
  // Radius
  "--tug-base-radius-2xs": { type: "invariant", value: "1px" },
  "--tug-base-radius-xs": { type: "invariant", value: "2px" },
  "--tug-base-radius-sm": { type: "invariant", value: "4px" },
  "--tug-base-radius-md": { type: "invariant", value: "6px" },
  "--tug-base-radius-lg": { type: "invariant", value: "8px" },
  "--tug-base-radius-xl": { type: "invariant", value: "12px" },
  "--tug-base-radius-2xl": { type: "invariant", value: "16px" },
  // Chrome
  "--tug-base-chrome-height": { type: "invariant", value: "36px" },
  // Icon sizes
  "--tug-base-icon-size-2xs": { type: "invariant", value: "10px" },
  "--tug-base-icon-size-xs": { type: "invariant", value: "12px" },
  "--tug-base-icon-size-sm": { type: "invariant", value: "13px" },
  "--tug-base-icon-size-md": { type: "invariant", value: "15px" },
  "--tug-base-icon-size-lg": { type: "invariant", value: "20px" },
  "--tug-base-icon-size-xl": { type: "invariant", value: "24px" },
  // Motion
  "--tug-base-motion-duration-fast": { type: "invariant", value: "calc(100ms * var(--tug-timing))" },
  "--tug-base-motion-duration-moderate": { type: "invariant", value: "calc(200ms * var(--tug-timing))" },
  "--tug-base-motion-duration-slow": { type: "invariant", value: "calc(350ms * var(--tug-timing))" },
  "--tug-base-motion-duration-glacial": { type: "invariant", value: "calc(500ms * var(--tug-timing))" },
  "--tug-base-motion-duration-instant": { type: "invariant", value: "calc(0ms * var(--tug-timing))" },
  "--tug-base-motion-easing-standard": { type: "invariant", value: "cubic-bezier(0.2, 0, 0, 1)" },
  "--tug-base-motion-easing-enter": { type: "invariant", value: "cubic-bezier(0, 0, 0, 1)" },
  "--tug-base-motion-easing-exit": { type: "invariant", value: "cubic-bezier(0.2, 0, 1, 1)" },
  // Control disabled opacity (invariant — always 50% regardless of mode or theme)
  "--tug-base-control-disabled-opacity": { type: "invariant", value: "0.5" },
};

// ---------------------------------------------------------------------------
// CORE_VISUAL_RULES — merged rule table for section A (Step 5)
// ---------------------------------------------------------------------------

/**
 * Rule table for core visual tokens: surfaces, foreground, icon,
 * borders/dividers, elevation/overlay, and invariants.
 *
 * Evaluated in parallel with the imperative deriveTheme() body in Step 5.
 * In Step 7, this table (combined with Step 6 rules) replaces the imperative code.
 */
export const CORE_VISUAL_RULES: Record<string, DerivationRule> = {
  ...SURFACE_RULES,
  ...FOREGROUND_RULES,
  ...ICON_RULES,
  ...BORDER_RULES,
  ...ELEVATION_RULES,
  ...INVARIANT_RULES,
};

// ---------------------------------------------------------------------------
// B. Accent System
// ---------------------------------------------------------------------------

const ACCENT_RULES: Record<string, DerivationRule> = {
  // accent-default: accent hue at signalI, t:50
  "--tug-base-accent-default": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // accent-subtle: accent hue at signalI, t:50, a:15
  "--tug-base-accent-subtle": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(50),
    alphaExpr: lit(15),
  },

  // accent-cool-default: txt hue at i:90, t:50 (cobalt-intense)
  "--tug-base-accent-cool-default": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: lit(90),
    toneExpr: lit(50),
  },
};

// ---------------------------------------------------------------------------
// C. Semantic Tones — factory helper
// Each semantic family has 5 tokens: {family}, {family}-bg, {family}-fg,
// {family}-border, {family}-icon
// bg uses alpha 15 (caution uses 12), others use alpha 100.
// ---------------------------------------------------------------------------

import type { Expr } from "./theme-derivation-engine";

function signalIExpr(): Expr {
  return (_p, _k, computed) => computed.signalI;
}

/**
 * Build the 5 semantic tone rules for a named family.
 * hueSlot: direct ResolvedHueSlots key (accent, active, agent, data, success, caution, destructive)
 * bgAlpha: 15 for most; 12 for caution.
 */
function semanticToneFamilyRules(
  family: string,
  hueSlot: string,
  bgAlpha: number,
): Record<string, DerivationRule> {
  const base = `--tug-base-tone-${family}`;
  const si = signalIExpr();
  return {
    [base]: { type: "chromatic", hueSlot, intensityExpr: si, toneExpr: lit(50) },
    [`${base}-bg`]: { type: "chromatic", hueSlot, intensityExpr: si, toneExpr: lit(50), alphaExpr: lit(bgAlpha) },
    [`${base}-fg`]: { type: "chromatic", hueSlot, intensityExpr: si, toneExpr: lit(50) },
    [`${base}-border`]: { type: "chromatic", hueSlot, intensityExpr: si, toneExpr: lit(50) },
    [`${base}-icon`]: { type: "chromatic", hueSlot, intensityExpr: si, toneExpr: lit(50) },
  };
}

const SEMANTIC_TONE_RULES: Record<string, DerivationRule> = {
  ...semanticToneFamilyRules("accent", "accent", 15),
  ...semanticToneFamilyRules("active", "active", 15),
  ...semanticToneFamilyRules("agent", "agent", 15),
  ...semanticToneFamilyRules("data", "data", 15),
  ...semanticToneFamilyRules("success", "success", 15),
  ...semanticToneFamilyRules("caution", "caution", 12),
  ...semanticToneFamilyRules("danger", "destructive", 15),
};

// ---------------------------------------------------------------------------
// D. Selection / Highlight / Preview
// ---------------------------------------------------------------------------

const SELECTION_RULES: Record<string, DerivationRule> = {
  // selection-bg: interactive hue at i:50, t:50, a:40
  "--tug-base-selection-bg": {
    type: "chromatic",
    hueSlot: "interactive",
    intensityExpr: lit(50),
    toneExpr: lit(50),
    alphaExpr: lit(40),
  },

  // selection-bg-inactive: hueSlot "selectionInactive" -> yellow (dark) | atm-20° (light)
  // Dark: i:0, t:30, a:25; Light: i:8, t:24, a:20
  "--tug-base-selection-bg-inactive": {
    type: "chromatic",
    hueSlot: "selectionInactive",
    intensityExpr: (preset) => (preset.isLight ? 8 : 0),
    toneExpr: (preset) => (preset.isLight ? 24 : 30),
    alphaExpr: (preset) => (preset.isLight ? 20 : 25),
  },

  // selection-fg: txt hue at txtI, fgDefaultTone
  "--tug-base-selection-fg": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.fgDefaultTone,
  },

  // highlight-hover: "__verboseHighlight" dark (i:0, t:100, a:5) | "__shadow" light (a:4)
  // Preset-mediated via highlightHoverHueSlot
  "--tug-base-highlight-hover": {
    type: "chromatic",
    hueSlot: "highlightHover",
    intensityExpr: lit(0),
    toneExpr: lit(100),
    alphaExpr: (preset) => preset.highlightHoverAlpha,
  },

  // highlight-dropTarget: interactive hue at i:50, t:50, a:18
  "--tug-base-highlight-dropTarget": {
    type: "chromatic",
    hueSlot: "interactive",
    intensityExpr: lit(50),
    toneExpr: lit(50),
    alphaExpr: lit(18),
  },

  // highlight-preview: interactive hue at i:50, t:50, a:12
  "--tug-base-highlight-preview": {
    type: "chromatic",
    hueSlot: "interactive",
    intensityExpr: lit(50),
    toneExpr: lit(50),
    alphaExpr: lit(12),
  },

  // highlight-inspectorTarget: interactive hue at i:50, t:50, a:22
  "--tug-base-highlight-inspectorTarget": {
    type: "chromatic",
    hueSlot: "interactive",
    intensityExpr: lit(50),
    toneExpr: lit(50),
    alphaExpr: lit(22),
  },

  // highlight-snapGuide: interactive hue at i:50, t:50, a:50
  "--tug-base-highlight-snapGuide": {
    type: "chromatic",
    hueSlot: "interactive",
    intensityExpr: lit(50),
    toneExpr: lit(50),
    alphaExpr: lit(50),
  },

  // highlight-flash: accent hue at signalI, t:50, a:35
  "--tug-base-highlight-flash": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(50),
    alphaExpr: lit(35),
  },
};

// ---------------------------------------------------------------------------
// D2. Tab Chrome
// ---------------------------------------------------------------------------

const TAB_CHROME_RULES: Record<string, DerivationRule> = {
  // tab-bg-active: hueSlot "tabBgActive" -> "cardFrame" dark | "atm" light
  "--tug-base-tab-bg-active": {
    type: "chromatic",
    hueSlot: "tabBgActive",
    intensityExpr: (preset) => preset.cardFrameActiveI,
    toneExpr: (preset) => preset.cardFrameActiveTone,
  },

  // tab-bg-inactive: hueSlot "tabBgInactive" -> "cardFrame" dark | "atm" light
  "--tug-base-tab-bg-inactive": {
    type: "chromatic",
    hueSlot: "tabBgInactive",
    intensityExpr: (preset) => preset.cardFrameInactiveI,
    toneExpr: (preset) => preset.cardFrameInactiveTone,
  },

  // tab-bg-collapsed: always atm hue at inactive intensity/tone
  "--tug-base-tab-bg-collapsed": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (preset) => preset.cardFrameInactiveI,
    toneExpr: (preset) => preset.cardFrameInactiveTone,
  },

  // tab-bg-hover: "__highlight" dark (a:8) | "__shadow" light (a:6)
  // Preset-mediated via tabBgHoverHueSlot
  "--tug-base-tab-bg-hover": {
    type: "chromatic",
    hueSlot: "tabBgHover",
    intensityExpr: lit(0),
    toneExpr: lit(0),
    alphaExpr: (preset) => preset.tabBgHoverAlpha,
  },

  // tab-fg-rest: txt hue at txtISubtle, t:50 (canonical)
  "--tug-base-tab-fg-rest": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (preset) => preset.txtISubtle,
    toneExpr: lit(50),
  },

  // tab-fg-hover: txt hue at txtI, tabFgActiveTone (90 dark | fgDefaultTone light)
  "--tug-base-tab-fg-hover": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.tabFgActiveTone,
  },

  // tab-fg-active: same as tab-fg-hover
  "--tug-base-tab-fg-active": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.tabFgActiveTone,
  },

  // tab-close-bg-hover: "__highlight" dark (a:12) | "__shadow" light (a:10)
  // Preset-mediated via tabCloseBgHoverHueSlot
  "--tug-base-tab-close-bg-hover": {
    type: "chromatic",
    hueSlot: "tabCloseBgHover",
    intensityExpr: lit(0),
    toneExpr: lit(0),
    alphaExpr: (preset) => preset.tabCloseBgHoverAlpha,
  },

  // tab-close-fg-hover: same as tab-fg-active
  "--tug-base-tab-close-fg-hover": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.tabFgActiveTone,
  },
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Disabled
// ---------------------------------------------------------------------------

const DISABLED_RULES: Record<string, DerivationRule> = {
  // disabled-bg: hueSlot "disabledBg" -> "surfBareBase" dark | "atm" light
  "--tug-base-control-disabled-bg": {
    type: "chromatic",
    hueSlot: "disabledBg",
    intensityExpr: (preset) => preset.disabledBgI,
    toneExpr: (_p, _k, computed) => computed.disabledBgTone,
  },

  // disabled-fg: fgDisabled hue at txtISubtle, disabledFgTone
  "--tug-base-control-disabled-fg": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (preset) => preset.txtISubtle,
    toneExpr: (_p, _k, computed) => computed.disabledFgTone,
  },

  // disabled-border: atm hue at disabledBorderI, disabledBorderTone
  "--tug-base-control-disabled-border": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (preset) => preset.disabledBorderI,
    toneExpr: (_p, _k, computed) => computed.disabledBorderTone,
  },

  // disabled-icon: same as disabled-fg
  "--tug-base-control-disabled-icon": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (preset) => preset.txtISubtle,
    toneExpr: (_p, _k, computed) => computed.disabledFgTone,
  },

  // disabled-shadow: structural "none"
  "--tug-base-control-disabled-shadow": {
    type: "structural",
    valueExpr: () => "none",
  },
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Filled roles factory
// Each filled role (accent, action, danger, agent, data, success, caution)
// produces 12 tokens: bg/fg/border/icon × rest/hover/active
// ---------------------------------------------------------------------------

/**
 * Build 12 filled-emphasis control tokens for a role.
 *
 * bg formula:
 *   rest:   hueSlot at i:50, t:filledBgDarkTone
 *   hover:  hueSlot at i:55, t:filledBgHoverTone
 *   active: hueSlot at i:90, t:filledBgActiveTone
 *
 * fg/icon formula (txt hue, light text on dark bg):
 *   all states: txt at Math.max(1, txtI-1), t:100
 *
 * border formula:
 *   rest:   hueSlot at Math.min(90, signalI+5), t:50
 *   hover:  hueSlot at Math.min(90, signalI+15), t:50
 *   active: hueSlot at i:90, t:filledBgActiveTone
 */
function filledRoleRules(role: string, hueSlot: string): Record<string, DerivationRule> {
  const base = `--tug-base-control-filled-${role}`;
  const filledFgI: Expr = (preset) => Math.max(1, preset.txtI - 1);
  return {
    // bg
    [`${base}-bg-rest`]: { type: "chromatic", hueSlot, intensityExpr: lit(50), toneExpr: (preset) => preset.filledBgDarkTone },
    [`${base}-bg-hover`]: { type: "chromatic", hueSlot, intensityExpr: lit(55), toneExpr: (preset) => preset.filledBgHoverTone },
    [`${base}-bg-active`]: { type: "chromatic", hueSlot, intensityExpr: lit(90), toneExpr: (preset) => preset.filledBgActiveTone },
    // fg
    [`${base}-fg-rest`]: { type: "chromatic", hueSlot: "txt", intensityExpr: filledFgI, toneExpr: lit(100) },
    [`${base}-fg-hover`]: { type: "chromatic", hueSlot: "txt", intensityExpr: filledFgI, toneExpr: lit(100) },
    [`${base}-fg-active`]: { type: "chromatic", hueSlot: "txt", intensityExpr: filledFgI, toneExpr: lit(100) },
    // border
    [`${base}-border-rest`]: { type: "chromatic", hueSlot, intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 5), toneExpr: lit(50) },
    [`${base}-border-hover`]: { type: "chromatic", hueSlot, intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 15), toneExpr: lit(50) },
    [`${base}-border-active`]: { type: "chromatic", hueSlot, intensityExpr: lit(90), toneExpr: (preset) => preset.filledBgActiveTone },
    // icon
    [`${base}-icon-rest`]: { type: "chromatic", hueSlot: "txt", intensityExpr: filledFgI, toneExpr: lit(100) },
    [`${base}-icon-hover`]: { type: "chromatic", hueSlot: "txt", intensityExpr: filledFgI, toneExpr: lit(100) },
    [`${base}-icon-active`]: { type: "chromatic", hueSlot: "txt", intensityExpr: filledFgI, toneExpr: lit(100) },
  };
}

const FILLED_RULES: Record<string, DerivationRule> = {
  ...filledRoleRules("accent", "accent"),
  ...filledRoleRules("action", "active"),
  ...filledRoleRules("danger", "destructive"),
  ...filledRoleRules("agent", "agent"),
  ...filledRoleRules("data", "data"),
  ...filledRoleRules("success", "success"),
  ...filledRoleRules("caution", "caution"),
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Outlined roles
// Outlined roles (action, agent, option): 4 props × 3 states = 12 tokens each
// bg-rest: transparent (structural)
// bg-hover/active: preset-mediated "outlinedBgHover/Active" sentinel or chromatic
// fg/icon: mode-dependent via preset fields
// border: role hue at signalI+5/+15/+25
// ---------------------------------------------------------------------------

/**
 * Build outlined-{role} rules (action, agent, option).
 *
 * bg-rest: transparent
 * bg-hover/active: hueSlot "outlinedBgHover"/"outlinedBgActive" (sentinel __highlight dark,
 *   chromatic "atm" light with outlinedBgHover/Active tones)
 *
 * fg/icon mode dispatch (dark: uniform outlinedFgTone/I; light: per-state preset fields):
 *   For "action": outlinedActionFg{state}ToneLight / outlinedActionIcon{state}ToneLight
 *   For "agent":  outlinedAgentFg{state}ToneLight / ...
 *   For "option": outlinedOptionFg{state}ToneLight / ...
 *
 * border: roleHueSlot at Math.min(90, signalI+{5,15,25}), t:50
 */
function outlinedFgRules(role: string, hueSlot: string): Record<string, DerivationRule> {
  const base = `--tug-base-control-outlined-${role}`;
  const capitalRole = role.charAt(0).toUpperCase() + role.slice(1);

  // fg tones per state: dark uses outlinedFgTone (uniform); light uses per-state preset fields.
  function fgToneExpr(state: "Rest" | "Hover" | "Active"): Expr {
    const lightField = (`outlined${capitalRole}Fg${state}ToneLight`) as keyof import("./theme-derivation-engine").ModePreset;
    return (preset) => preset.isLight ? (preset[lightField] as number) : preset.outlinedFgTone;
  }
  function fgIExpr(): Expr {
    return (preset) => preset.isLight ? preset.txtI : preset.outlinedFgI;
  }

  // icon tones per state: dark uses outlinedFgTone (uniform); light uses per-state preset fields.
  function iconToneExpr(state: "Rest" | "Hover" | "Active"): Expr {
    const lightField = (`outlined${capitalRole}Icon${state}ToneLight`) as keyof import("./theme-derivation-engine").ModePreset;
    return (preset) => preset.isLight ? (preset[lightField] as number) : preset.outlinedFgTone;
  }
  function iconIExpr(): Expr {
    return (preset) => preset.isLight ? preset.txtISubtle : preset.outlinedFgI;
  }

  return {
    [`${base}-bg-rest`]: { type: "structural", valueExpr: () => "transparent" },
    // bg-hover: __highlight in dark (uses alphaExpr for highlight alpha), chromatic in light (no alpha = opaque)
    [`${base}-bg-hover`]: { type: "chromatic", hueSlot: "outlinedBgHover", intensityExpr: (preset) => (preset.isLight ? 4 : 0), toneExpr: (_p, _k, computed) => computed.outlinedBgHoverTone, alphaExpr: (preset) => preset.isLight ? 100 : preset.outlinedBgHoverAlpha },
    // bg-active: __highlight in dark (uses alphaExpr for highlight alpha), chromatic in light (no alpha = opaque)
    [`${base}-bg-active`]: { type: "chromatic", hueSlot: "outlinedBgActive", intensityExpr: (preset) => (preset.isLight ? 6 : 0), toneExpr: (_p, _k, computed) => computed.outlinedBgActiveTone, alphaExpr: (preset) => preset.isLight ? 100 : preset.outlinedBgActiveAlpha },
    // fg
    [`${base}-fg-rest`]: { type: "chromatic", hueSlot: "txt", intensityExpr: fgIExpr(), toneExpr: fgToneExpr("Rest") },
    [`${base}-fg-hover`]: { type: "chromatic", hueSlot: "txt", intensityExpr: fgIExpr(), toneExpr: fgToneExpr("Hover") },
    [`${base}-fg-active`]: { type: "chromatic", hueSlot: "txt", intensityExpr: fgIExpr(), toneExpr: fgToneExpr("Active") },
    // border
    [`${base}-border-rest`]: { type: "chromatic", hueSlot, intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 5), toneExpr: lit(50) },
    [`${base}-border-hover`]: { type: "chromatic", hueSlot, intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 15), toneExpr: lit(50) },
    [`${base}-border-active`]: { type: "chromatic", hueSlot, intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 25), toneExpr: lit(50) },
    // icon
    [`${base}-icon-rest`]: { type: "chromatic", hueSlot: "txt", intensityExpr: iconIExpr(), toneExpr: iconToneExpr("Rest") },
    [`${base}-icon-hover`]: { type: "chromatic", hueSlot: "txt", intensityExpr: iconIExpr(), toneExpr: iconToneExpr("Hover") },
    [`${base}-icon-active`]: { type: "chromatic", hueSlot: "txt", intensityExpr: iconIExpr(), toneExpr: iconToneExpr("Active") },
  };
}

// Outlined-option has neutral text-hue borders (not role-colored) — separate factory
function outlinedOptionBorderRules(): Record<string, DerivationRule> {
  const base = "--tug-base-control-outlined-option";
  return {
    // Override the borders from outlinedFgRules with neutral txt-hue borders
    [`${base}-border-rest`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.txtISubtle,
      toneExpr: (preset) => preset.outlinedOptionBorderRestTone,
    },
    [`${base}-border-hover`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => Math.min(90, preset.txtISubtle + 2),
      toneExpr: (preset) => preset.outlinedOptionBorderHoverTone,
    },
    [`${base}-border-active`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => Math.min(90, preset.txtISubtle + 4),
      toneExpr: (preset) => preset.outlinedOptionBorderActiveTone,
    },
  };
}

const OUTLINED_RULES: Record<string, DerivationRule> = {
  ...outlinedFgRules("action", "active"),
  ...outlinedFgRules("agent", "agent"),
  ...outlinedFgRules("option", "active"), // option uses active slot for border initially; overridden below
  // Override outlined-option borders with neutral formulas
  ...outlinedOptionBorderRules(),
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Ghost roles (action, danger, option)
// ---------------------------------------------------------------------------

/**
 * Build ghost-action rules.
 * bg-rest/border-rest: transparent (structural)
 * bg-hover/active: preset-mediated sentinel ("__highlight" dark | "__shadow" light)
 * fg/icon: mode-dependent per-state preset fields
 * border-hover/active: txt hue at ghostActionBorderI, ghostActionBorderTone
 */
function ghostActionRules(): Record<string, DerivationRule> {
  const base = "--tug-base-control-ghost-action";
  return {
    [`${base}-bg-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`${base}-bg-hover`]: { type: "chromatic", hueSlot: "ghostActionBgHover", intensityExpr: lit(0), toneExpr: lit(0), alphaExpr: (preset) => preset.ghostActionBgHoverAlpha },
    [`${base}-bg-active`]: { type: "chromatic", hueSlot: "ghostActionBgActive", intensityExpr: lit(0), toneExpr: lit(0), alphaExpr: (preset) => preset.ghostActionBgActiveAlpha },
    // fg
    [`${base}-fg-rest`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.ghostActionFgRestILight : preset.ghostActionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostActionFgRestToneLight : preset.ghostActionFgTone,
    },
    [`${base}-fg-hover`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.ghostActionFgHoverILight : preset.ghostActionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostActionFgHoverToneLight : preset.ghostActionFgTone,
    },
    [`${base}-fg-active`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.ghostActionFgActiveILight : preset.ghostActionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostActionFgActiveToneLight : preset.ghostActionFgTone,
    },
    // border
    [`${base}-border-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`${base}-border-hover`]: { type: "chromatic", hueSlot: "txt", intensityExpr: (preset) => preset.ghostActionBorderI, toneExpr: (preset) => preset.ghostActionBorderTone },
    [`${base}-border-active`]: { type: "chromatic", hueSlot: "txt", intensityExpr: (preset) => preset.ghostActionBorderI, toneExpr: (preset) => preset.ghostActionBorderTone },
    // icon
    [`${base}-icon-rest`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.txtISubtle : preset.ghostActionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostActionIconRestToneLight : preset.ghostActionFgTone,
    },
    [`${base}-icon-hover`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.txtISubtle : preset.ghostActionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostActionIconHoverToneLight : preset.ghostActionFgTone,
    },
    [`${base}-icon-active`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.ghostActionIconActiveILight : preset.ghostActionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostActionIconActiveToneLight : preset.ghostActionFgTone,
    },
  };
}

/**
 * Build ghost-danger rules.
 * bg-rest/border-rest: transparent
 * bg-hover/active: destructive hue at signalI+5, t:50, a: ghostDangerBgHoverAlpha/ActiveAlpha
 * fg/icon: destructive hue at signalI+5/+15/+25, t:50
 * border-hover/active: destructive hue at signalI+5, t:50, a:40/60
 */
function ghostDangerRules(): Record<string, DerivationRule> {
  const base = "--tug-base-control-ghost-danger";
  return {
    [`${base}-bg-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`${base}-bg-hover`]: { type: "chromatic", hueSlot: "destructive", intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 5), toneExpr: lit(50), alphaExpr: (preset) => preset.ghostDangerBgHoverAlpha },
    [`${base}-bg-active`]: { type: "chromatic", hueSlot: "destructive", intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 5), toneExpr: lit(50), alphaExpr: (preset) => preset.ghostDangerBgActiveAlpha },
    [`${base}-fg-rest`]: { type: "chromatic", hueSlot: "destructive", intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 5), toneExpr: lit(50) },
    [`${base}-fg-hover`]: { type: "chromatic", hueSlot: "destructive", intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 15), toneExpr: lit(50) },
    [`${base}-fg-active`]: { type: "chromatic", hueSlot: "destructive", intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 25), toneExpr: lit(50) },
    [`${base}-border-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`${base}-border-hover`]: { type: "chromatic", hueSlot: "destructive", intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 5), toneExpr: lit(50), alphaExpr: lit(40) },
    [`${base}-border-active`]: { type: "chromatic", hueSlot: "destructive", intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 5), toneExpr: lit(50), alphaExpr: lit(60) },
    [`${base}-icon-rest`]: { type: "chromatic", hueSlot: "destructive", intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 5), toneExpr: lit(50) },
    [`${base}-icon-hover`]: { type: "chromatic", hueSlot: "destructive", intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 15), toneExpr: lit(50) },
    [`${base}-icon-active`]: { type: "chromatic", hueSlot: "destructive", intensityExpr: (_p, _k, computed) => Math.min(90, computed.signalI + 25), toneExpr: lit(50) },
  };
}

/**
 * Build ghost-option rules — same pattern as ghost-action but with separate preset fields.
 */
function ghostOptionRules(): Record<string, DerivationRule> {
  const base = "--tug-base-control-ghost-option";
  return {
    [`${base}-bg-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`${base}-bg-hover`]: { type: "chromatic", hueSlot: "ghostOptionBgHover", intensityExpr: lit(0), toneExpr: lit(0), alphaExpr: (preset) => preset.ghostOptionBgHoverAlpha },
    [`${base}-bg-active`]: { type: "chromatic", hueSlot: "ghostOptionBgActive", intensityExpr: lit(0), toneExpr: lit(0), alphaExpr: (preset) => preset.ghostOptionBgActiveAlpha },
    // fg
    [`${base}-fg-rest`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.ghostOptionFgRestILight : preset.ghostOptionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostOptionFgRestToneLight : preset.ghostOptionFgTone,
    },
    [`${base}-fg-hover`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.ghostOptionFgHoverILight : preset.ghostOptionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostOptionFgHoverToneLight : preset.ghostOptionFgTone,
    },
    [`${base}-fg-active`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.ghostOptionFgActiveILight : preset.ghostOptionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostOptionFgActiveToneLight : preset.ghostOptionFgTone,
    },
    // border
    [`${base}-border-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`${base}-border-hover`]: { type: "chromatic", hueSlot: "txt", intensityExpr: (preset) => preset.ghostOptionBorderI, toneExpr: (preset) => preset.ghostOptionBorderTone },
    [`${base}-border-active`]: { type: "chromatic", hueSlot: "txt", intensityExpr: (preset) => preset.ghostOptionBorderI, toneExpr: (preset) => preset.ghostOptionBorderTone },
    // icon
    [`${base}-icon-rest`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.txtISubtle : preset.ghostOptionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostOptionIconRestToneLight : preset.ghostOptionFgTone,
    },
    [`${base}-icon-hover`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.txtISubtle : preset.ghostOptionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostOptionIconHoverToneLight : preset.ghostOptionFgTone,
    },
    [`${base}-icon-active`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (preset) => preset.isLight ? preset.ghostOptionIconActiveILight : preset.ghostOptionFgI,
      toneExpr: (preset) => preset.isLight ? preset.ghostOptionIconActiveToneLight : preset.ghostOptionFgTone,
    },
  };
}

const GHOST_RULES: Record<string, DerivationRule> = {
  ...ghostActionRules(),
  ...ghostDangerRules(),
  ...ghostOptionRules(),
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Selected / Highlighted / Surface Control
// ---------------------------------------------------------------------------

const SELECTED_HIGHLIGHTED_RULES: Record<string, DerivationRule> = {
  // surface-control: alias to outlined-action-bg-rest (transparent)
  "--tug-base-surface-control": {
    type: "structural",
    valueExpr: () => "var(--tug-base-control-outlined-action-bg-rest)",
  },

  // selected tokens
  "--tug-base-control-selected-bg": { type: "chromatic", hueSlot: "active", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(18) },
  "--tug-base-control-selected-bg-hover": { type: "chromatic", hueSlot: "active", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(24) },
  "--tug-base-control-selected-fg": { type: "chromatic", hueSlot: "txt", intensityExpr: (preset) => preset.txtI, toneExpr: (preset) => preset.fgDefaultTone },
  "--tug-base-control-selected-border": { type: "chromatic", hueSlot: "active", intensityExpr: lit(50), toneExpr: lit(50) },
  "--tug-base-control-selected-disabled-bg": { type: "chromatic", hueSlot: "active", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(10) },

  // highlighted tokens
  "--tug-base-control-highlighted-bg": { type: "chromatic", hueSlot: "active", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(10) },
  "--tug-base-control-highlighted-fg": { type: "chromatic", hueSlot: "txt", intensityExpr: (preset) => preset.txtI, toneExpr: (preset) => preset.fgDefaultTone },
  "--tug-base-control-highlighted-border": { type: "chromatic", hueSlot: "active", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(25) },
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Field tokens
// ---------------------------------------------------------------------------

const FIELD_RULES: Record<string, DerivationRule> = {
  // field-bg-rest: atm hue; dark: i=atmI; light: i=fieldBgRestI (7)
  "--tug-base-field-bg-rest": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (preset) => preset.fieldBgRestI,
    toneExpr: (preset) => preset.fieldBgRestTone,
  },

  // field-bg-hover: hueSlot "fieldBgHover" -> "surfBareBase" dark | "atm" light
  "--tug-base-field-bg-hover": {
    type: "chromatic",
    hueSlot: "fieldBgHover",
    intensityExpr: (preset) => preset.atmI,
    toneExpr: (preset) => preset.fieldBgHoverTone,
  },

  // field-bg-focus: atm hue at i:4, fieldBgFocusTone
  "--tug-base-field-bg-focus": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: lit(4),
    toneExpr: (preset) => preset.fieldBgFocusTone,
  },

  // field-bg-disabled: atm hue at atmI, fieldBgDisabledTone
  "--tug-base-field-bg-disabled": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (preset) => preset.atmI,
    toneExpr: (preset) => preset.fieldBgDisabledTone,
  },

  // field-bg-readOnly: hueSlot "fieldBgReadOnly" -> "surfBareBase" dark | "atm" light
  "--tug-base-field-bg-readOnly": {
    type: "chromatic",
    hueSlot: "fieldBgReadOnly",
    intensityExpr: (preset) => preset.atmI,
    toneExpr: (preset) => preset.fieldBgReadOnlyTone,
  },

  // field-fg: txt hue at txtI, fgDefaultTone
  "--tug-base-field-fg": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.fgDefaultTone,
  },

  // field-fg-disabled: fgDisabled hue at txtISubtle, fgDisabledTone
  "--tug-base-field-fg-disabled": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (preset) => preset.txtISubtle,
    toneExpr: (preset) => preset.fgDisabledTone,
  },

  // field-fg-readOnly: fgMuted hue at fgMutedI, fgMutedTone
  "--tug-base-field-fg-readOnly": {
    type: "chromatic",
    hueSlot: "fgMuted",
    intensityExpr: (preset) => preset.fgMutedI,
    toneExpr: (preset) => preset.fgMutedTone,
  },

  // field-placeholder: hueSlot "fieldPlaceholder" -> "fgPlaceholder" dark | "atm" light
  "--tug-base-field-placeholder": {
    type: "chromatic",
    hueSlot: "fieldPlaceholder",
    intensityExpr: (preset) => preset.atmIBorder,
    toneExpr: (preset) => preset.fgPlaceholderTone,
  },

  // field-border-rest: hueSlot "fieldBorderRest" -> "fgPlaceholder" dark | "atm" light
  "--tug-base-field-border-rest": {
    type: "chromatic",
    hueSlot: "fieldBorderRest",
    intensityExpr: (preset) => preset.atmIBorder,
    toneExpr: (preset) => preset.fgPlaceholderTone,
  },

  // field-border-hover: hueSlot "fieldBorderHover" -> "fgSubtle" dark | "borderStrong" light
  "--tug-base-field-border-hover": {
    type: "chromatic",
    hueSlot: "fieldBorderHover",
    intensityExpr: (preset) => preset.borderIStrong,
    toneExpr: (preset) => preset.isLight ? preset.borderStrongTone : preset.fgSubtleTone,
  },

  // field-border-active: interactive hue at canonical i:50, t:50
  "--tug-base-field-border-active": {
    type: "chromatic",
    hueSlot: "interactive",
    intensityExpr: lit(50),
    toneExpr: lit(50),
  },

  // field-border-danger: destructive hue at signalI, t:50
  "--tug-base-field-border-danger": {
    type: "chromatic",
    hueSlot: "destructive",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // field-border-success: success hue at signalI, t:50
  "--tug-base-field-border-success": {
    type: "chromatic",
    hueSlot: "success",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // field-border-disabled: atm hue at atmIBorder, dividerTone
  "--tug-base-field-border-disabled": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (preset) => preset.atmIBorder,
    toneExpr: (_p, _k, computed) => computed.dividerTone,
  },

  // field-border-readOnly: atm hue at atmIBorder, dividerTone
  "--tug-base-field-border-readOnly": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (preset) => preset.atmIBorder,
    toneExpr: (_p, _k, computed) => computed.dividerTone,
  },

  // field-label: txt hue at txtI, fgDefaultTone
  "--tug-base-field-label": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.fgDefaultTone,
  },

  // field-required: destructive hue at signalI, t:50
  "--tug-base-field-required": {
    type: "chromatic",
    hueSlot: "destructive",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // field-tone-danger: destructive hue at signalI, t:50
  "--tug-base-field-tone-danger": {
    type: "chromatic",
    hueSlot: "destructive",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // field-tone-caution: caution hue at signalI, t:50
  "--tug-base-field-tone-caution": {
    type: "chromatic",
    hueSlot: "caution",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // field-tone-success: success hue at signalI, t:50
  "--tug-base-field-tone-success": {
    type: "chromatic",
    hueSlot: "success",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Toggle / Range
// ---------------------------------------------------------------------------

const TOGGLE_RULES: Record<string, DerivationRule> = {
  // toggle-track-off: atm hue at atmIBorder, toggleTrackOffTone
  "--tug-base-toggle-track-off": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (preset) => preset.atmIBorder,
    toneExpr: (_p, _k, computed) => computed.toggleTrackOffTone,
  },

  // toggle-track-off-hover: atm hue at min(atmIBorder+4,100), min(toggleTrackOffTone+8,100)
  "--tug-base-toggle-track-off-hover": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (preset) => Math.min(preset.atmIBorder + 4, 100),
    toneExpr: (_p, _k, computed) => Math.min(computed.toggleTrackOffTone + 8, 100),
  },

  // toggle-track-on: accent hue at signalI, t:42 (muted preset)
  "--tug-base-toggle-track-on": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (_p, _k, computed) => computed.signalI,
    toneExpr: lit(42),
  },

  // toggle-track-on-hover: accent hue at min(signalI+5,100), toggleTrackOnHoverTone
  "--tug-base-toggle-track-on-hover": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (_p, _k, computed) => Math.min(computed.signalI + 5, 100),
    toneExpr: (preset) => preset.toggleTrackOnHoverTone,
  },

  // toggle-track-disabled: hueSlot "toggleTrackDisabled" -> "surfBareBase" dark | "atm" light
  "--tug-base-toggle-track-disabled": {
    type: "chromatic",
    hueSlot: "toggleTrackDisabled",
    intensityExpr: (preset) => preset.toggleTrackDisabledI,
    toneExpr: (_p, _k, computed) => computed.toggleDisabledTone,
  },

  // toggle-track-mixed: fgSubtle hue at txtISubtle, fgSubtleTone
  "--tug-base-toggle-track-mixed": {
    type: "chromatic",
    hueSlot: "fgSubtle",
    intensityExpr: (preset) => preset.txtISubtle,
    toneExpr: (preset) => preset.fgSubtleTone,
  },

  // toggle-track-mixed-hover: fgSubtle hue at min(txtISubtle+5,100), min(fgSubtleTone+6,100)
  "--tug-base-toggle-track-mixed-hover": {
    type: "chromatic",
    hueSlot: "fgSubtle",
    intensityExpr: (preset) => Math.min(preset.txtISubtle + 5, 100),
    toneExpr: (preset) => Math.min(preset.fgSubtleTone + 6, 100),
  },

  // toggle-thumb: hueSlot "toggleThumb" -> "fgInverse" dark | "__white" light
  "--tug-base-toggle-thumb": {
    type: "chromatic",
    hueSlot: "toggleThumb",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.fgInverseTone,
  },

  // toggle-thumb-disabled: fgDisabled hue at txtISubtle, toggleThumbDisabledTone
  "--tug-base-toggle-thumb-disabled": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (preset) => preset.txtISubtle,
    toneExpr: (preset) => preset.toggleThumbDisabledTone,
  },

  // toggle-icon-disabled: fgDisabled hue at txtISubtle, toggleThumbDisabledTone
  "--tug-base-toggle-icon-disabled": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (preset) => preset.txtISubtle,
    toneExpr: (preset) => preset.toggleThumbDisabledTone,
  },

  // toggle-icon-mixed: fgMuted hue at fgMutedI, fgMutedTone
  "--tug-base-toggle-icon-mixed": {
    type: "chromatic",
    hueSlot: "fgMuted",
    intensityExpr: (preset) => preset.fgMutedI,
    toneExpr: (preset) => preset.fgMutedTone,
  },

  // checkmark: hueSlot "checkmark" -> "fgInverse" dark | "__white" light
  "--tug-base-checkmark": {
    type: "chromatic",
    hueSlot: "checkmark",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.fgInverseTone,
  },

  // checkmark-mixed: fgMuted hue at fgMutedI, fgMutedTone
  "--tug-base-checkmark-mixed": {
    type: "chromatic",
    hueSlot: "fgMuted",
    intensityExpr: (preset) => preset.fgMutedI,
    toneExpr: (preset) => preset.fgMutedTone,
  },

  // radio-dot: hueSlot "radioDot" -> "fgInverse" dark | "__white" light
  "--tug-base-radio-dot": {
    type: "chromatic",
    hueSlot: "radioDot",
    intensityExpr: (preset) => preset.txtI,
    toneExpr: (preset) => preset.fgInverseTone,
  },

  // separator: atm hue at atmIBorder, toggleTrackOffTone
  "--tug-base-separator": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (preset) => preset.atmIBorder,
    toneExpr: (_p, _k, computed) => computed.toggleTrackOffTone,
  },

};

// ---------------------------------------------------------------------------
// F. Badge Tinted — factory helper
// 7 roles × 3 properties (fg, bg, border) = 21 tokens
// ---------------------------------------------------------------------------

/**
 * Build 3 badge-tinted tokens for a role.
 * FG: role hue at badgeTintedFgI, badgeTintedFgTone (alpha=100)
 * BG: role hue at badgeTintedBgI, badgeTintedBgTone, alpha=badgeTintedBgAlpha
 * Border: role hue at badgeTintedBorderI, badgeTintedBorderTone, alpha=badgeTintedBorderAlpha
 */
function badgeTintedRoleRules(role: string, hueSlot: string): Record<string, DerivationRule> {
  const base = `--tug-base-badge-tinted-${role}`;
  return {
    [`${base}-fg`]: {
      type: "chromatic",
      hueSlot,
      intensityExpr: (preset) => preset.badgeTintedFgI,
      toneExpr: (preset) => preset.badgeTintedFgTone,
    },
    [`${base}-bg`]: {
      type: "chromatic",
      hueSlot,
      intensityExpr: (preset) => preset.badgeTintedBgI,
      toneExpr: (preset) => preset.badgeTintedBgTone,
      alphaExpr: (preset) => preset.badgeTintedBgAlpha,
    },
    [`${base}-border`]: {
      type: "chromatic",
      hueSlot,
      intensityExpr: (preset) => preset.badgeTintedBorderI,
      toneExpr: (preset) => preset.badgeTintedBorderTone,
      alphaExpr: (preset) => preset.badgeTintedBorderAlpha,
    },
  };
}

const BADGE_TINTED_RULES: Record<string, DerivationRule> = {
  ...badgeTintedRoleRules("accent", "accent"),
  ...badgeTintedRoleRules("action", "active"),
  ...badgeTintedRoleRules("agent", "agent"),
  ...badgeTintedRoleRules("data", "data"),
  ...badgeTintedRoleRules("danger", "destructive"),
  ...badgeTintedRoleRules("success", "success"),
  ...badgeTintedRoleRules("caution", "caution"),
};

// ---------------------------------------------------------------------------
// RULES — complete merged rule table for all 373 tokens (Steps 5 and 6)
// ---------------------------------------------------------------------------

/**
 * Complete derivation rule table for all 373 --tug-base-* tokens.
 *
 * Sections A-F combined. In Step 7, evaluateRules(RULES, ...) replaces
 * the entire imperative deriveTheme() body.
 */
export const RULES: Record<string, DerivationRule> = {
  ...SURFACE_RULES,
  ...FOREGROUND_RULES,
  ...ICON_RULES,
  ...BORDER_RULES,
  ...ELEVATION_RULES,
  ...INVARIANT_RULES,
  ...ACCENT_RULES,
  ...SEMANTIC_TONE_RULES,
  ...SELECTION_RULES,
  ...TAB_CHROME_RULES,
  ...DISABLED_RULES,
  ...FILLED_RULES,
  ...OUTLINED_RULES,
  ...GHOST_RULES,
  ...SELECTED_HIGHLIGHTED_RULES,
  ...FIELD_RULES,
  ...TOGGLE_RULES,
  ...BADGE_TINTED_RULES,
};
