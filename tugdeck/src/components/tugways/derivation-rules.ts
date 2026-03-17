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
 *   - Formulas-mediated names (e.g., "bgApp", "surfaceSunken") ->
 *     formulas[name + "HueSlot"] yields the actual ResolvedHueSlots key.
 * Sentinel values [D07]: "__white" | "__highlight" | "__shadow" | "__verboseHighlight"
 *
 * @module components/tugways/derivation-rules
 */

import type {
  DerivationRule,
  Expr,
  DerivationFormulas,
  ComputedTones,
  ChromaticRule,
} from "./theme-derivation-engine";

// Local type alias for concise builder signatures [D01]
type F = DerivationFormulas;

// ---------------------------------------------------------------------------
// Helpers for common intensity/tone patterns
// ---------------------------------------------------------------------------

/** Literal number expression: always returns the same value. */
function lit(n: number): () => number {
  return () => n;
}

// ---------------------------------------------------------------------------
// Named formula builders — [D04] defined at module scope above rule tables
// ---------------------------------------------------------------------------

/**
 * surface — chromatic rule for a surface token.
 * hueSlot: formulas-mediated slot name (e.g. "bgApp", "surfaceSunken")
 * iField: keyof F for the intensity formula field
 * toneKey: keyof ComputedTones for the computed tone
 */
function surface(
  hueSlot: string,
  iField: keyof F,
  toneKey: keyof ComputedTones,
): ChromaticRule {
  return {
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => formulas[iField] as number,
    toneExpr: (_f, _k, computed) => computed[toneKey] as number,
  };
}

/**
 * filledFg — filled control fg/icon rule.
 * Always: txt hue, intensity = Math.max(1, txtI - 1), tone = 100.
 */
function filledFg(): ChromaticRule {
  return {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (formulas) => Math.max(1, formulas.txtI - 1),
    toneExpr: lit(100),
  };
}

/**
 * outlinedFg — outlined/ghost control fg or icon rule.
 * Always: txt hue, intensity from iField, tone from toneField.
 */
function outlinedFg(iField: keyof F, toneField: keyof F): ChromaticRule {
  return {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (formulas) => formulas[iField] as number,
    toneExpr: (formulas) => formulas[toneField] as number,
  };
}

/**
 * borderRamp — higher-order builder for role-colored signal borders.
 * Returns a function (hueSlot) => ChromaticRule at signalI+offset, t:50.
 */
function borderRamp(offset: number): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (_f, _k, computed) => Math.min(90, computed.signalI + offset),
    toneExpr: lit(50),
  });
}

/** borderRest — borderRamp(5): signal border at rest state */
const borderRest = borderRamp(5);
/** borderHover — borderRamp(15): signal border at hover state */
const borderHover = borderRamp(15);
/** borderActive — borderRamp(25): signal border at active state (for outlined) */
const borderActive = borderRamp(25);

/**
 * filledBg — higher-order builder for filled-control background rules.
 * Returns a function (hueSlot) => ChromaticRule at literal intensity, formula tone.
 */
function filledBg(
  intensity: number,
  toneField: keyof F,
): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: lit(intensity),
    toneExpr: (formulas) => formulas[toneField] as number,
  });
}

/** filledBgRest — filledBg(50, "filledBgDarkTone") */
const filledBgRest = filledBg(50, "filledBgDarkTone");
/** filledBgHover — filledBg(55, "filledBgHoverTone") */
const filledBgHover = filledBg(55, "filledBgHoverTone");
/** filledBgActive — filledBg(90, "filledBgActiveTone") */
const filledBgActive = filledBg(90, "filledBgActiveTone");

/**
 * semanticTone — semantic signal rule at signalI, t:50.
 * alpha?: optional fixed alpha (e.g. 15 for -bg tokens).
 * Returns a function (hueSlot) => ChromaticRule.
 */
function semanticTone(alpha?: number): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (_f, _k, computed) => computed.signalI,
    toneExpr: lit(50),
    ...(alpha !== undefined ? { alphaExpr: lit(alpha) } : {}),
  });
}

/**
 * badgeTinted — badge at role hue with formula-field intensity, tone, and optional alpha.
 * Returns a function (hueSlot) => ChromaticRule.
 */
function badgeTinted(
  iField: keyof F,
  toneField: keyof F,
  alphaField?: keyof F,
): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => formulas[iField] as number,
    toneExpr: (formulas) => formulas[toneField] as number,
    ...(alphaField !== undefined
      ? { alphaExpr: (formulas: F) => formulas[alphaField] as number }
      : {}),
  });
}

/**
 * signalRamp — signalI+offset at role hue, t:50 (no alpha).
 * Returns a function (hueSlot) => ChromaticRule.
 */
function signalRamp(offset: number): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (_f, _k, computed) => Math.min(90, computed.signalI + offset),
    toneExpr: lit(50),
  });
}

/**
 * signalRampAlpha — signalI+offset at role hue, t:50, fixed alpha.
 * Returns a function (hueSlot) => ChromaticRule.
 */
function signalRampAlpha(
  offset: number,
  alpha: number,
): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (_f, _k, computed) => Math.min(90, computed.signalI + offset),
    toneExpr: lit(50),
    alphaExpr: lit(alpha),
  });
}

/**
 * outlinedBg — outlined bg-hover/active rule.
 * hueSlot is the sentinel (e.g. "outlinedBgHover"/"outlinedBgActive").
 * iField: formula intensity, toneKey: computed tone, alphaField: formula alpha.
 * Returns a function (hueSlot) => ChromaticRule.
 */
function outlinedBg(
  iField: keyof F,
  toneKey: keyof ComputedTones,
  alphaField: keyof F,
): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => formulas[iField] as number,
    toneExpr: (_f, _k, computed) => computed[toneKey] as number,
    alphaExpr: (formulas) => formulas[alphaField] as number,
  });
}

/**
 * ghostBg — ghost background rule with callback alpha.
 * Always: zero intensity, zero tone, per-call alphaExpr.
 * Returns a function (hueSlot) => ChromaticRule.
 */
function ghostBg(alphaExpr: Expr): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: lit(0),
    toneExpr: lit(0),
    alphaExpr,
  });
}

/**
 * formulaField — generic chromatic rule reading hue slot, intensity, and tone from formula fields.
 * Takes hueSlot directly (not curried).
 */
function formulaField(
  hueSlot: string,
  iField: keyof F,
  toneField: keyof F,
): ChromaticRule {
  return {
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => formulas[iField] as number,
    toneExpr: (formulas) => formulas[toneField] as number,
  };
}

// ---------------------------------------------------------------------------
// A. Core Visual — Surfaces
// ---------------------------------------------------------------------------

const SURFACE_RULES: Record<string, DerivationRule> = {
  // bg-app: hueSlot "bgApp" -> formulas.bgAppHueSlot ("canvas" dark | "txt" light)
  "--tug-base-bg-app": surface("bgApp", "bgAppSurfaceI", "bgApp"),
  // bg-canvas: hueSlot "bgCanvas" -> formulas.bgCanvasHueSlot ("canvas" dark | "atm" light)
  "--tug-base-bg-canvas": surface("bgCanvas", "bgCanvasI", "bgCanvas"),
  // surface-sunken: hueSlot "surfaceSunken" -> "surfBareBase" dark | "atm" light
  "--tug-base-surface-sunken": surface("surfaceSunken", "atmI", "surfaceSunken"),
  // surface-default: hueSlot "surfaceDefault" -> "surfBareBase" dark | "atm" light
  "--tug-base-surface-default": surface("surfaceDefault", "surfaceDefaultI", "surfaceDefault"),
  // surface-raised: hueSlot "surfaceRaised" -> "atm" dark | "txt" light
  "--tug-base-surface-raised": surface("surfaceRaised", "surfaceRaisedI", "surfaceRaised"),
  // surface-overlay: hueSlot "surfaceOverlay" -> "surfBareBase" dark | "atm" light
  "--tug-base-surface-overlay": surface("surfaceOverlay", "surfaceOverlayI", "surfaceOverlay"),
  // surface-inset: hueSlot "surfaceInset" -> "atm" dark | "atm" light
  "--tug-base-surface-inset": surface("surfaceInset", "surfaceInsetI", "surfaceInset"),
  // surface-content: same hue slot as surface-inset, same tone
  "--tug-base-surface-content": surface("surfaceContent", "surfaceContentI", "surfaceContent"),
  // surface-screen: hueSlot "surfaceScreen" -> "surfScreen" dark | "txt" light
  "--tug-base-surface-screen": surface("surfaceScreen", "surfaceScreenI", "surfaceScreen"),
};

// ---------------------------------------------------------------------------
// A. Core Visual — Foreground / Text
// ---------------------------------------------------------------------------

const FOREGROUND_RULES: Record<string, DerivationRule> = {
  // fg-default: always txt hue (direct key)
  "--tug-base-fg-default": formulaField("txt", "txtI", "fgDefaultTone"),
  // fg-muted: hueSlot "fgMuted" -> "fgMuted" dark | "txt" light
  "--tug-base-fg-muted": formulaField("fgMuted", "fgMutedI", "fgMutedTone"),
  // fg-subtle: hueSlot "fgSubtle" -> "fgSubtle" dark | "txt" light
  "--tug-base-fg-subtle": formulaField("fgSubtle", "txtISubtle", "fgSubtleTone"),
  // fg-disabled: hueSlot "fgDisabled" -> "fgDisabled" dark | "txt" light
  "--tug-base-fg-disabled": formulaField("fgDisabled", "txtISubtle", "fgDisabledTone"),
  // fg-inverse: hueSlot "fgInverse" -> "fgInverse" dark | "txt" light
  "--tug-base-fg-inverse": formulaField("fgInverse", "fgInverseI", "fgInverseTone"),
  // fg-placeholder: hueSlot "fgPlaceholder" -> "fgPlaceholder" dark | "atm" light
  "--tug-base-fg-placeholder": formulaField("fgPlaceholder", "atmIBorder", "fgPlaceholderTone"),

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
  "--tug-base-fg-onAccent": formulaField("fgOnAccent", "txtI", "fgInverseTone"),
  // fg-onDanger: same as fg-onAccent
  "--tug-base-fg-onDanger": formulaField("fgOnAccent", "txtI", "fgInverseTone"),

  // fg-onCaution: atm hue, formula I, literal t:7 (dark text on bright bg)
  "--tug-base-fg-onCaution": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (formulas) => formulas.fgOnCautionI,
    toneExpr: lit(7),
  },

  // fg-onSuccess: atm hue, formula I, literal t:7
  "--tug-base-fg-onSuccess": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (formulas) => formulas.fgOnSuccessI,
    toneExpr: lit(7),
  },
};

// ---------------------------------------------------------------------------
// A. Core Visual — Icon
// ---------------------------------------------------------------------------

const ICON_RULES: Record<string, DerivationRule> = {
  // icon-default: same as fg-muted
  "--tug-base-icon-default": formulaField("fgMuted", "fgMutedI", "fgMutedTone"),
  // icon-muted: hueSlot "iconMuted" -> "fgSubtle" dark | "atm" light
  "--tug-base-icon-muted": formulaField("iconMuted", "iconMutedI", "iconMutedTone"),
  // icon-disabled: same as fg-disabled
  "--tug-base-icon-disabled": formulaField("fgDisabled", "txtISubtle", "fgDisabledTone"),

  // icon-active: vivid txt hue, literal i:100, formula tone — mixed lit/formula, inline
  "--tug-base-icon-active": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: lit(100),
    toneExpr: (formulas) => formulas.iconActiveTone,
  },

  // icon-onAccent: hueSlot "iconOnAccent" -> "fgInverse" dark | "__white" light
  "--tug-base-icon-onAccent": formulaField("iconOnAccent", "txtI", "fgInverseTone"),
};

// ---------------------------------------------------------------------------
// A. Core Visual — Borders / Dividers
// ---------------------------------------------------------------------------

const BORDER_RULES: Record<string, DerivationRule> = {
  // border-default: borderTint hue at borderIBase, fgPlaceholderTone
  "--tug-base-border-default": formulaField("borderTint", "borderIBase", "fgPlaceholderTone"),
  // border-muted: borderTint hue at borderMutedI, borderMutedTone
  "--tug-base-border-muted": formulaField("borderTint", "borderMutedI", "borderMutedTone"),
  // border-strong: borderStrong hue (borderTint -5°) at borderIStrong, borderStrongTone
  "--tug-base-border-strong": formulaField("borderStrong", "borderIStrong", "borderStrongTone"),
  // border-inverse: txt hue at txtI, fgDefaultTone
  "--tug-base-border-inverse": formulaField("txt", "txtI", "fgDefaultTone"),

  // border-accent: accent hue at signalI, t:50 (direct key — mode-independent)
  "--tug-base-border-accent": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (_f, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // border-danger: destructive hue at signalI, t:50 (direct key — mode-independent)
  "--tug-base-border-danger": {
    type: "chromatic",
    hueSlot: "destructive",
    intensityExpr: (_f, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // divider-default: borderTint hue at dividerDefaultI, dividerDefault
  "--tug-base-divider-default": {
    type: "chromatic",
    hueSlot: "borderTint",
    intensityExpr: (formulas) => formulas.dividerDefaultI,
    toneExpr: (_f, _k, computed) => computed.dividerDefault,
  },

  // divider-muted: hueSlot "dividerMuted" -> "borderTintBareBase" dark | "borderTint" light
  "--tug-base-divider-muted": {
    type: "chromatic",
    hueSlot: "dividerMuted",
    intensityExpr: (formulas) => formulas.dividerMutedI,
    toneExpr: (_f, _k, computed) => computed.dividerMuted,
  },
};

// ---------------------------------------------------------------------------
// A. Core Visual — Elevation / Overlay
// ---------------------------------------------------------------------------

const ELEVATION_RULES: Record<string, DerivationRule> = {
  "--tug-base-shadow-xs": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.shadowXsAlpha,
  },
  "--tug-base-shadow-md": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.shadowMdAlpha,
  },
  "--tug-base-shadow-lg": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.shadowLgAlpha,
  },
  "--tug-base-shadow-xl": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.shadowXlAlpha,
  },

  // shadow-overlay: composite value "0 4px 16px --tug-color(black, ...)"
  // Uses StructuralRule with resolvedExpr so resolved map is populated.
  "--tug-base-shadow-overlay": {
    type: "structural",
    valueExpr: (formulas) =>
      `0 4px 16px --tug-color(black, i: 0, t: 0, a: ${formulas.shadowOverlayAlpha})`,
    resolvedExpr: (formulas) => ({ L: 0, C: 0, h: 0, alpha: formulas.shadowOverlayAlpha / 100 }),
  },

  "--tug-base-overlay-dim": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.overlayDimAlpha,
  },
  "--tug-base-overlay-scrim": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.overlayScrimAlpha,
  },

  // overlay-highlight: always verbose white form (i:0, t:100, a:N) per [D07] __verboseHighlight
  // Uses ChromaticRule with hueSlot "__verboseHighlight" (direct sentinel — not formulas-mediated)
  "--tug-base-overlay-highlight": {
    type: "chromatic",
    hueSlot: "__verboseHighlight",
    intensityExpr: lit(0),
    toneExpr: lit(100),
    alphaExpr: (formulas) => formulas.overlayHighlightAlpha,
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
// CORE_VISUAL_RULES — merged rule table for section A
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
  return {
    [base]: semanticTone()(hueSlot),
    [`${base}-bg`]: semanticTone(bgAlpha)(hueSlot),
    [`${base}-fg`]: semanticTone()(hueSlot),
    [`${base}-border`]: semanticTone()(hueSlot),
    [`${base}-icon`]: semanticTone()(hueSlot),
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
    intensityExpr: (formulas) => formulas.selectionBgInactiveI,
    toneExpr: (formulas) => formulas.selectionBgInactiveTone,
    alphaExpr: (formulas) => formulas.selectionBgInactiveAlpha,
  },

  // selection-fg: txt hue at txtI, fgDefaultTone
  "--tug-base-selection-fg": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (formulas) => formulas.txtI,
    toneExpr: (formulas) => formulas.fgDefaultTone,
  },

  // highlight-hover: "__verboseHighlight" dark (i:0, t:100, a:5) | "__shadow" light (a:4)
  // Formulas-mediated via highlightHoverHueSlot
  "--tug-base-highlight-hover": {
    type: "chromatic",
    hueSlot: "highlightHover",
    intensityExpr: lit(0),
    toneExpr: lit(100),
    alphaExpr: (formulas) => formulas.highlightHoverAlpha,
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
    intensityExpr: (formulas) => formulas.cardFrameActiveI,
    toneExpr: (formulas) => formulas.cardFrameActiveTone,
  },

  // tab-bg-inactive: hueSlot "tabBgInactive" -> "cardFrame" dark | "atm" light
  "--tug-base-tab-bg-inactive": {
    type: "chromatic",
    hueSlot: "tabBgInactive",
    intensityExpr: (formulas) => formulas.cardFrameInactiveI,
    toneExpr: (formulas) => formulas.cardFrameInactiveTone,
  },

  // tab-bg-collapsed: always atm hue at inactive intensity/tone
  "--tug-base-tab-bg-collapsed": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (formulas) => formulas.cardFrameInactiveI,
    toneExpr: (formulas) => formulas.cardFrameInactiveTone,
  },

  // tab-bg-hover: "__highlight" dark (a:8) | "__shadow" light (a:6)
  // Formulas-mediated via tabBgHoverHueSlot
  "--tug-base-tab-bg-hover": {
    type: "chromatic",
    hueSlot: "tabBgHover",
    intensityExpr: lit(0),
    toneExpr: lit(0),
    alphaExpr: (formulas) => formulas.tabBgHoverAlpha,
  },

  // tab-fg-rest: txt hue at txtISubtle, t:50 (canonical)
  "--tug-base-tab-fg-rest": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (formulas) => formulas.txtISubtle,
    toneExpr: lit(50),
  },

  // tab-fg-hover: txt hue at txtI, tabFgActiveTone (90 dark | fgDefaultTone light)
  "--tug-base-tab-fg-hover": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (formulas) => formulas.txtI,
    toneExpr: (formulas) => formulas.tabFgActiveTone,
  },

  // tab-fg-active: same as tab-fg-hover
  "--tug-base-tab-fg-active": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (formulas) => formulas.txtI,
    toneExpr: (formulas) => formulas.tabFgActiveTone,
  },

  // tab-close-bg-hover: "__highlight" dark (a:12) | "__shadow" light (a:10)
  // Formulas-mediated via tabCloseBgHoverHueSlot
  "--tug-base-tab-close-bg-hover": {
    type: "chromatic",
    hueSlot: "tabCloseBgHover",
    intensityExpr: lit(0),
    toneExpr: lit(0),
    alphaExpr: (formulas) => formulas.tabCloseBgHoverAlpha,
  },

  // tab-close-fg-hover: same as tab-fg-active
  "--tug-base-tab-close-fg-hover": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (formulas) => formulas.txtI,
    toneExpr: (formulas) => formulas.tabFgActiveTone,
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
    intensityExpr: (formulas) => formulas.disabledBgI,
    toneExpr: (_f, _k, computed) => computed.disabledBgTone,
  },

  // disabled-fg: fgDisabled hue at txtISubtle, disabledFgTone
  "--tug-base-control-disabled-fg": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (formulas) => formulas.txtISubtle,
    toneExpr: (_f, _k, computed) => computed.disabledFgTone,
  },

  // disabled-border: atm hue at disabledBorderI, disabledBorderTone
  "--tug-base-control-disabled-border": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (formulas) => formulas.disabledBorderI,
    toneExpr: (_f, _k, computed) => computed.disabledBorderTone,
  },

  // disabled-icon: same as disabled-fg
  "--tug-base-control-disabled-icon": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (formulas) => formulas.txtISubtle,
    toneExpr: (_f, _k, computed) => computed.disabledFgTone,
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
 *   active: hueSlot at i:90, t:filledBgActiveTone  (same as filledBgActive)
 */
function filledRoleRules(role: string, hueSlot: string): Record<string, DerivationRule> {
  const base = `--tug-base-control-filled-${role}`;
  return {
    // bg
    [`${base}-bg-rest`]: filledBgRest(hueSlot),
    [`${base}-bg-hover`]: filledBgHover(hueSlot),
    [`${base}-bg-active`]: filledBgActive(hueSlot),
    // fg
    [`${base}-fg-rest`]: filledFg(),
    [`${base}-fg-hover`]: filledFg(),
    [`${base}-fg-active`]: filledFg(),
    // border
    [`${base}-border-rest`]: borderRest(hueSlot),
    [`${base}-border-hover`]: borderHover(hueSlot),
    [`${base}-border-active`]: filledBgActive(hueSlot),
    // icon
    [`${base}-icon-rest`]: filledFg(),
    [`${base}-icon-hover`]: filledFg(),
    [`${base}-icon-active`]: filledFg(),
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
 * fg/icon: emphasis-level fields shared across all roles (Table T01 D02):
 *   outlinedFg{Rest,Hover,Active}Tone, outlinedFgI (fg)
 *   outlinedIcon{Rest,Hover,Active}Tone, outlinedIconI (icon)
 *
 * border: roleHueSlot at Math.min(90, signalI+{5,15,25}), t:50
 */
function outlinedFgRules(role: string, hueSlot: string): Record<string, DerivationRule> {
  const base = `--tug-base-control-outlined-${role}`;

  return {
    [`${base}-bg-rest`]: { type: "structural", valueExpr: () => "transparent" },
    // bg-hover: unified intensity/alpha from formulas (dark: 0/outlinedBgHoverAlpha; light: chromatic 4/100)
    [`${base}-bg-hover`]: outlinedBg("outlinedBgHoverI", "outlinedBgHoverTone", "outlinedBgHoverAlphaValue")("outlinedBgHover"),
    // bg-active: unified intensity/alpha from formulas (dark: 0/outlinedBgActiveAlpha; light: chromatic 6/100)
    [`${base}-bg-active`]: outlinedBg("outlinedBgActiveI", "outlinedBgActiveTone", "outlinedBgActiveAlphaValue")("outlinedBgActive"),
    // fg — emphasis-level fields (Table T01 D02), same across all outlined roles
    [`${base}-fg-rest`]: outlinedFg("outlinedFgI", "outlinedFgRestTone"),
    [`${base}-fg-hover`]: outlinedFg("outlinedFgI", "outlinedFgHoverTone"),
    [`${base}-fg-active`]: outlinedFg("outlinedFgI", "outlinedFgActiveTone"),
    // border
    [`${base}-border-rest`]: borderRest(hueSlot),
    [`${base}-border-hover`]: borderHover(hueSlot),
    [`${base}-border-active`]: borderActive(hueSlot),
    // icon — emphasis-level fields (Table T01 D02), same across all outlined roles
    [`${base}-icon-rest`]: outlinedFg("outlinedIconI", "outlinedIconRestTone"),
    [`${base}-icon-hover`]: outlinedFg("outlinedIconI", "outlinedIconHoverTone"),
    [`${base}-icon-active`]: outlinedFg("outlinedIconI", "outlinedIconActiveTone"),
  };
}

// Outlined-option has neutral text-hue borders (not role-colored) — separate factory.
// Distinct pattern: txtISubtle-based intensity ramp with formula tone fields.
function outlinedOptionBorderRules(): Record<string, DerivationRule> {
  const base = "--tug-base-control-outlined-option";
  return {
    // Override the borders from outlinedFgRules with neutral txt-hue borders
    [`${base}-border-rest`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (formulas) => formulas.txtISubtle,
      toneExpr: (formulas) => formulas.outlinedOptionBorderRestTone,
    },
    [`${base}-border-hover`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (formulas) => Math.min(90, formulas.txtISubtle + 2),
      toneExpr: (formulas) => formulas.outlinedOptionBorderHoverTone,
    },
    [`${base}-border-active`]: {
      type: "chromatic",
      hueSlot: "txt",
      intensityExpr: (formulas) => Math.min(90, formulas.txtISubtle + 4),
      toneExpr: (formulas) => formulas.outlinedOptionBorderActiveTone,
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
 * Build ghost-{role} rules (action, option).
 * Unified factory — both roles share emphasis-level fg/icon/border fields (Table T02 D02).
 * Per-role exceptions: bgHoverHueSlot, bgActiveHueSlot, and the alpha formula fields
 * remain per-role because the bg sentinel hue slot may differ between roles in light mode.
 *
 * bg-rest/border-rest: transparent (structural)
 * bg-hover/active: per-role sentinel hue slot (e.g. "ghostActionBgHover" / "ghostOptionBgHover")
 * fg/icon: emphasis-level fields ghostFg{Rest,Hover,Active}Tone/I, ghostIcon{Rest,Hover,Active}Tone/I
 * border-hover/active: txt hue at ghostBorderI, ghostBorderTone (shared)
 */
function ghostFgRules(
  role: "action" | "option",
  bgHoverHueSlot: string,
  bgActiveHueSlot: string,
  bgHoverAlphaExpr: (formulas: DerivationFormulas) => number,
  bgActiveAlphaExpr: (formulas: DerivationFormulas) => number,
): Record<string, DerivationRule> {
  const base = `--tug-base-control-ghost-${role}`;
  return {
    [`${base}-bg-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`${base}-bg-hover`]: ghostBg(bgHoverAlphaExpr)(bgHoverHueSlot),
    [`${base}-bg-active`]: ghostBg(bgActiveAlphaExpr)(bgActiveHueSlot),
    // fg — emphasis-level fields (Table T02 D02), shared across ghost action and option
    [`${base}-fg-rest`]: outlinedFg("ghostFgRestI", "ghostFgRestTone"),
    [`${base}-fg-hover`]: outlinedFg("ghostFgHoverI", "ghostFgHoverTone"),
    [`${base}-fg-active`]: outlinedFg("ghostFgActiveI", "ghostFgActiveTone"),
    // border
    [`${base}-border-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`${base}-border-hover`]: outlinedFg("ghostBorderI", "ghostBorderTone"),
    [`${base}-border-active`]: outlinedFg("ghostBorderI", "ghostBorderTone"),
    // icon — emphasis-level fields (Table T02 D02), shared across ghost action and option
    [`${base}-icon-rest`]: outlinedFg("ghostIconRestI", "ghostIconRestTone"),
    [`${base}-icon-hover`]: outlinedFg("ghostIconHoverI", "ghostIconHoverTone"),
    [`${base}-icon-active`]: outlinedFg("ghostIconActiveI", "ghostIconActiveTone"),
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
    // bg-hover/active: signalI+5 at destructive hue, t:50, formula-driven alpha
    [`${base}-bg-hover`]: { ...signalRamp(5)("destructive"), alphaExpr: (formulas) => formulas.ghostDangerBgHoverAlpha },
    [`${base}-bg-active`]: { ...signalRamp(5)("destructive"), alphaExpr: (formulas) => formulas.ghostDangerBgActiveAlpha },
    [`${base}-fg-rest`]: signalRamp(5)("destructive"),
    [`${base}-fg-hover`]: signalRamp(15)("destructive"),
    [`${base}-fg-active`]: signalRamp(25)("destructive"),
    [`${base}-border-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`${base}-border-hover`]: signalRampAlpha(5, 40)("destructive"),
    [`${base}-border-active`]: signalRampAlpha(5, 60)("destructive"),
    [`${base}-icon-rest`]: signalRamp(5)("destructive"),
    [`${base}-icon-hover`]: signalRamp(15)("destructive"),
    [`${base}-icon-active`]: signalRamp(25)("destructive"),
  };
}

const GHOST_RULES: Record<string, DerivationRule> = {
  ...ghostFgRules(
    "action",
    "ghostActionBgHover",
    "ghostActionBgActive",
    (formulas) => formulas.ghostActionBgHoverAlpha,
    (formulas) => formulas.ghostActionBgActiveAlpha,
  ),
  ...ghostDangerRules(),
  ...ghostFgRules(
    "option",
    "ghostOptionBgHover",
    "ghostOptionBgActive",
    (formulas) => formulas.ghostOptionBgHoverAlpha,
    (formulas) => formulas.ghostOptionBgActiveAlpha,
  ),
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
  "--tug-base-control-selected-fg": { type: "chromatic", hueSlot: "txt", intensityExpr: (formulas) => formulas.txtI, toneExpr: (formulas) => formulas.fgDefaultTone },
  "--tug-base-control-selected-border": { type: "chromatic", hueSlot: "active", intensityExpr: lit(50), toneExpr: lit(50) },
  "--tug-base-control-selected-disabled-bg": { type: "chromatic", hueSlot: "active", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(10) },

  // highlighted tokens
  "--tug-base-control-highlighted-bg": { type: "chromatic", hueSlot: "active", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(10) },
  "--tug-base-control-highlighted-fg": { type: "chromatic", hueSlot: "txt", intensityExpr: (formulas) => formulas.txtI, toneExpr: (formulas) => formulas.fgDefaultTone },
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
    intensityExpr: (formulas) => formulas.fieldBgRestI,
    toneExpr: (formulas) => formulas.fieldBgRestTone,
  },

  // field-bg-hover: hueSlot "fieldBgHover" -> "surfBareBase" dark | "atm" light
  "--tug-base-field-bg-hover": {
    type: "chromatic",
    hueSlot: "fieldBgHover",
    intensityExpr: (formulas) => formulas.atmI,
    toneExpr: (formulas) => formulas.fieldBgHoverTone,
  },

  // field-bg-focus: atm hue at i:4, fieldBgFocusTone
  "--tug-base-field-bg-focus": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: lit(4),
    toneExpr: (formulas) => formulas.fieldBgFocusTone,
  },

  // field-bg-disabled: atm hue at atmI, fieldBgDisabledTone
  "--tug-base-field-bg-disabled": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (formulas) => formulas.atmI,
    toneExpr: (formulas) => formulas.fieldBgDisabledTone,
  },

  // field-bg-readOnly: hueSlot "fieldBgReadOnly" -> "surfBareBase" dark | "atm" light
  "--tug-base-field-bg-readOnly": {
    type: "chromatic",
    hueSlot: "fieldBgReadOnly",
    intensityExpr: (formulas) => formulas.atmI,
    toneExpr: (formulas) => formulas.fieldBgReadOnlyTone,
  },

  // field-fg: txt hue at txtI, fgDefaultTone
  "--tug-base-field-fg": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (formulas) => formulas.txtI,
    toneExpr: (formulas) => formulas.fgDefaultTone,
  },

  // field-fg-disabled: fgDisabled hue at txtISubtle, fgDisabledTone
  "--tug-base-field-fg-disabled": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (formulas) => formulas.txtISubtle,
    toneExpr: (formulas) => formulas.fgDisabledTone,
  },

  // field-fg-readOnly: fgMuted hue at fgMutedI, fgMutedTone
  "--tug-base-field-fg-readOnly": {
    type: "chromatic",
    hueSlot: "fgMuted",
    intensityExpr: (formulas) => formulas.fgMutedI,
    toneExpr: (formulas) => formulas.fgMutedTone,
  },

  // field-placeholder: hueSlot "fieldPlaceholder" -> "fgPlaceholder" dark | "atm" light
  "--tug-base-field-placeholder": {
    type: "chromatic",
    hueSlot: "fieldPlaceholder",
    intensityExpr: (formulas) => formulas.atmIBorder,
    toneExpr: (formulas) => formulas.fgPlaceholderTone,
  },

  // field-border-rest: hueSlot "fieldBorderRest" -> "fgPlaceholder" dark | "atm" light
  "--tug-base-field-border-rest": {
    type: "chromatic",
    hueSlot: "fieldBorderRest",
    intensityExpr: (formulas) => formulas.atmIBorder,
    toneExpr: (formulas) => formulas.fgPlaceholderTone,
  },

  // field-border-hover: hueSlot "fieldBorderHover" -> "fgSubtle" dark | "borderStrong" light
  // borderStrongToneValue is the unified field (dark: fgSubtleTone; light: borderStrongTone)
  "--tug-base-field-border-hover": {
    type: "chromatic",
    hueSlot: "fieldBorderHover",
    intensityExpr: (formulas) => formulas.borderIStrong,
    toneExpr: (formulas) => formulas.borderStrongToneValue,
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
    intensityExpr: (_f, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // field-border-success: success hue at signalI, t:50
  "--tug-base-field-border-success": {
    type: "chromatic",
    hueSlot: "success",
    intensityExpr: (_f, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // field-border-disabled: atm hue at atmIBorder, dividerTone
  "--tug-base-field-border-disabled": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (formulas) => formulas.atmIBorder,
    toneExpr: (_f, _k, computed) => computed.dividerTone,
  },

  // field-border-readOnly: atm hue at atmIBorder, dividerTone
  "--tug-base-field-border-readOnly": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (formulas) => formulas.atmIBorder,
    toneExpr: (_f, _k, computed) => computed.dividerTone,
  },

  // field-label: txt hue at txtI, fgDefaultTone
  "--tug-base-field-label": {
    type: "chromatic",
    hueSlot: "txt",
    intensityExpr: (formulas) => formulas.txtI,
    toneExpr: (formulas) => formulas.fgDefaultTone,
  },

  // field-required: destructive hue at signalI, t:50
  "--tug-base-field-required": {
    type: "chromatic",
    hueSlot: "destructive",
    intensityExpr: (_f, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // field-tone-danger: destructive hue at signalI, t:50
  "--tug-base-field-tone-danger": {
    type: "chromatic",
    hueSlot: "destructive",
    intensityExpr: (_f, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // field-tone-caution: caution hue at signalI, t:50
  "--tug-base-field-tone-caution": {
    type: "chromatic",
    hueSlot: "caution",
    intensityExpr: (_f, _k, computed) => computed.signalI,
    toneExpr: lit(50),
  },

  // field-tone-success: success hue at signalI, t:50
  "--tug-base-field-tone-success": {
    type: "chromatic",
    hueSlot: "success",
    intensityExpr: (_f, _k, computed) => computed.signalI,
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
    intensityExpr: (formulas) => formulas.atmIBorder,
    toneExpr: (_f, _k, computed) => computed.toggleTrackOffTone,
  },

  // toggle-track-off-hover: atm hue at min(atmIBorder+4,100), min(toggleTrackOffTone+8,100)
  "--tug-base-toggle-track-off-hover": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (formulas) => Math.min(formulas.atmIBorder + 4, 100),
    toneExpr: (_f, _k, computed) => Math.min(computed.toggleTrackOffTone + 8, 100),
  },

  // toggle-track-on: accent hue at signalI, t:42 (muted preset)
  "--tug-base-toggle-track-on": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (_f, _k, computed) => computed.signalI,
    toneExpr: lit(42),
  },

  // toggle-track-on-hover: accent hue at min(signalI+5,100), toggleTrackOnHoverTone
  "--tug-base-toggle-track-on-hover": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (_f, _k, computed) => Math.min(computed.signalI + 5, 100),
    toneExpr: (formulas) => formulas.toggleTrackOnHoverTone,
  },

  // toggle-track-disabled: hueSlot "toggleTrackDisabled" -> "surfBareBase" dark | "atm" light
  "--tug-base-toggle-track-disabled": {
    type: "chromatic",
    hueSlot: "toggleTrackDisabled",
    intensityExpr: (formulas) => formulas.toggleTrackDisabledI,
    toneExpr: (_f, _k, computed) => computed.toggleDisabledTone,
  },

  // toggle-track-mixed: fgSubtle hue at txtISubtle, fgSubtleTone
  "--tug-base-toggle-track-mixed": {
    type: "chromatic",
    hueSlot: "fgSubtle",
    intensityExpr: (formulas) => formulas.txtISubtle,
    toneExpr: (formulas) => formulas.fgSubtleTone,
  },

  // toggle-track-mixed-hover: fgSubtle hue at min(txtISubtle+5,100), min(fgSubtleTone+6,100)
  "--tug-base-toggle-track-mixed-hover": {
    type: "chromatic",
    hueSlot: "fgSubtle",
    intensityExpr: (formulas) => Math.min(formulas.txtISubtle + 5, 100),
    toneExpr: (formulas) => Math.min(formulas.fgSubtleTone + 6, 100),
  },

  // toggle-thumb: hueSlot "toggleThumb" -> "fgInverse" dark | "__white" light
  "--tug-base-toggle-thumb": {
    type: "chromatic",
    hueSlot: "toggleThumb",
    intensityExpr: (formulas) => formulas.txtI,
    toneExpr: (formulas) => formulas.fgInverseTone,
  },

  // toggle-thumb-disabled: fgDisabled hue at txtISubtle, toggleThumbDisabledTone
  "--tug-base-toggle-thumb-disabled": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (formulas) => formulas.txtISubtle,
    toneExpr: (formulas) => formulas.toggleThumbDisabledTone,
  },

  // toggle-icon-disabled: fgDisabled hue at txtISubtle, toggleThumbDisabledTone
  "--tug-base-toggle-icon-disabled": {
    type: "chromatic",
    hueSlot: "fgDisabled",
    intensityExpr: (formulas) => formulas.txtISubtle,
    toneExpr: (formulas) => formulas.toggleThumbDisabledTone,
  },

  // toggle-icon-mixed: fgMuted hue at fgMutedI, fgMutedTone
  "--tug-base-toggle-icon-mixed": {
    type: "chromatic",
    hueSlot: "fgMuted",
    intensityExpr: (formulas) => formulas.fgMutedI,
    toneExpr: (formulas) => formulas.fgMutedTone,
  },

  // checkmark: hueSlot "checkmark" -> "fgInverse" dark | "__white" light
  "--tug-base-checkmark": {
    type: "chromatic",
    hueSlot: "checkmark",
    intensityExpr: (formulas) => formulas.txtI,
    toneExpr: (formulas) => formulas.fgInverseTone,
  },

  // checkmark-mixed: fgMuted hue at fgMutedI, fgMutedTone
  "--tug-base-checkmark-mixed": {
    type: "chromatic",
    hueSlot: "fgMuted",
    intensityExpr: (formulas) => formulas.fgMutedI,
    toneExpr: (formulas) => formulas.fgMutedTone,
  },

  // radio-dot: hueSlot "radioDot" -> "fgInverse" dark | "__white" light
  "--tug-base-radio-dot": {
    type: "chromatic",
    hueSlot: "radioDot",
    intensityExpr: (formulas) => formulas.txtI,
    toneExpr: (formulas) => formulas.fgInverseTone,
  },

  // separator: atm hue at atmIBorder, toggleTrackOffTone
  "--tug-base-separator": {
    type: "chromatic",
    hueSlot: "atm",
    intensityExpr: (formulas) => formulas.atmIBorder,
    toneExpr: (_f, _k, computed) => computed.toggleTrackOffTone,
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
    [`${base}-fg`]: badgeTinted("badgeTintedFgI", "badgeTintedFgTone")(hueSlot),
    [`${base}-bg`]: badgeTinted("badgeTintedBgI", "badgeTintedBgTone", "badgeTintedBgAlpha")(hueSlot),
    [`${base}-border`]: badgeTinted("badgeTintedBorderI", "badgeTintedBorderTone", "badgeTintedBorderAlpha")(hueSlot),
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
// RULES — complete merged rule table for all 373 tokens
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
