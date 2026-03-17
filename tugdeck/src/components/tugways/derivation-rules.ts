/**
 * Derivation Rule Table — Core Visual Tokens (Step 5)
 *
 * Contains ChromaticRule, ShadowRule, HighlightRule, StructuralRule, and
 * InvariantRule entries for all core visual tokens in section A of deriveTheme():
 *   - Surfaces (~9 tokens)
 *   - Foreground / Text (~12 tokens)
 *   - Icon (~5 tokens)
 *   - Borders / Dividers (~8 tokens)
 *   - Elevation / Overlay (~8 tokens)
 *   - Invariants: typography, spacing, radius, chrome, icons, motion (~56 tokens)
 *
 * hueSlot names follow dual-path resolution [D09]:
 *   - Direct ResolvedHueSlots keys (e.g., "txt", "interactive", "borderTint") →
 *     mode-independent, resolved directly from resolvedSlots.
 *   - Preset-mediated names (e.g., "bgApp", "surfaceSunken") →
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
