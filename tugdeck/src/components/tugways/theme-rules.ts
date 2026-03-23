/**
 * Derivation Rule Table — All Token Rules (Steps 5 and 6)
 *
 * Contains ChromaticRule, ShadowRule, HighlightRule, StructuralRule, and
 * InvariantRule entries for ALL 373 --tug-* tokens.
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
 *   F2. Badge Outlined: 7 roles × 4 properties = 28 tokens
 *   F3. Badge Ghost: 7 roles × 4 properties = 28 tokens
 *
 * hueSlot names follow dual-path resolution [D09]:
 *   - Direct ResolvedHueSlots keys (e.g., "text", "action", "accent") ->
 *     mode-independent, resolved directly from resolvedSlots.
 *   - Formulas-mediated names (e.g., "surfaceApp", "surfaceSunken") ->
 *     formulas[name + "HueSlot"] yields the actual ResolvedHueSlots key.
 * Sentinel values [D07]: "white" | "highlight" | "shadow" | "highlightVerbose"
 *
 * @module components/tugways/theme-rules
 */

import type {
  DerivationRule,
  Expr,
  DerivationFormulas,
  ChromaticRule,
} from "./theme-engine";

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
 * hueSlot: formulas-mediated slot name (e.g. "surfaceApp", "surfaceSunken")
 * iField: keyof F for the intensity formula field
 * toneKey: keyof F for the pre-computed surface tone field
 */
function surface(
  hueSlot: string,
  iField: keyof F,
  toneKey: keyof F,
): ChromaticRule {
  return {
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => formulas[iField] as number,
    toneExpr: (formulas) => formulas[toneKey] as number,
  };
}

/**
 * filledFg — filled control fg/icon rule.
 * Always: control hue, intensity = Math.max(1, contentTextIntensity - 1), tone = 100.
 */
function filledFg(): ChromaticRule {
  return {
    type: "chromatic",
    hueSlot: "control",
    intensityExpr: (formulas) => Math.max(1, formulas.contentTextIntensity - 1),
    toneExpr: lit(100),
  };
}

/**
 * outlinedFg — outlined/ghost control fg or icon rule.
 * Role hue at emphasis-level intensity and tone.
 */
function outlinedFg(iField: keyof F, toneField: keyof F, hueSlot: string = "control"): ChromaticRule {
  return {
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => formulas[iField] as number,
    toneExpr: (formulas) => formulas[toneField] as number,
  };
}

/**
 * borderRamp — higher-order builder for role-colored role borders.
 * Returns a function (hueSlot) => ChromaticRule at roleIntensity+offset, borderRoleTone.
 */
function borderRamp(offset: number): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => Math.min(90, formulas.roleIntensity + offset),
    toneExpr: (f: F) => f.borderRoleTone,
  });
}

/** borderRest — borderRamp(5): role border at rest state */
const borderRest = borderRamp(5);
/** borderHover — borderRamp(15): role border at hover state */
const borderHover = borderRamp(15);
/** borderActive — borderRamp(25): role border at active state (for outlined) */
const borderActive = borderRamp(25);

/**
 * filledBg — higher-order builder for filled-control background rules.
 * Returns a function (hueSlot) => ChromaticRule at roleIntensity+offset, formula tone.
 * Intensity is driven by recipe.role.intensity (via roleIntensity) so the
 * Roles intensity slider controls button fill chroma.
 */
function filledBg(
  intensityOffset: number,
  toneField: keyof F,
): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => Math.min(90, formulas.roleIntensity + intensityOffset),
    toneExpr: (formulas) => formulas[toneField] as number,
  });
}

/** filledBgRest — filledBg(0, "filledSurfaceRestTone") — intensity at roleIntensity */
const filledBgRest = filledBg(0, "filledSurfaceRestTone");
/** filledBgHover — filledBg(5, "filledSurfaceHoverTone") — intensity at roleIntensity+5 */
const filledBgHover = filledBg(5, "filledSurfaceHoverTone");
/** filledBgActive — filledBg(40, "filledSurfaceActiveTone") — intensity at roleIntensity+40 */
const filledBgActive = filledBg(40, "filledSurfaceActiveTone");

/**
 * semanticTone — semantic role rule at roleIntensity, semanticRoleTone.
 * alpha?: optional fixed alpha (e.g. 15 for -bg tokens).
 * Returns a function (hueSlot) => ChromaticRule.
 */
function semanticTone(alpha?: number): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: (f: F) => f.semanticRoleTone,
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
 * roleRamp — roleIntensity+offset at role hue, t:50 (no alpha).
 * Returns a function (hueSlot) => ChromaticRule.
 */
function roleRamp(offset: number): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => Math.min(90, formulas.roleIntensity + offset),
    toneExpr: lit(50),
  });
}

/**
 * roleRampAlpha — roleIntensity+offset at role hue, t:50, fixed alpha.
 * Returns a function (hueSlot) => ChromaticRule.
 */
function roleRampAlpha(
  offset: number,
  alpha: number,
): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => Math.min(90, formulas.roleIntensity + offset),
    toneExpr: lit(50),
    alphaExpr: lit(alpha),
  });
}

/**
 * outlinedBg — outlined bg-hover/active rule.
 * hueSlot is the sentinel (e.g. "outlinedSurfaceHover"/"outlinedSurfaceActive").
 * iField: formula intensity, toneKey: formula tone field (pre-computed), alphaField: formula alpha.
 * Returns a function (hueSlot) => ChromaticRule.
 */
function outlinedBg(
  iField: keyof F,
  toneKey: keyof F,
  alphaField: keyof F,
): (hueSlot: string) => ChromaticRule {
  return (hueSlot: string): ChromaticRule => ({
    type: "chromatic",
    hueSlot,
    intensityExpr: (formulas) => formulas[iField] as number,
    toneExpr: (formulas) => formulas[toneKey] as number,
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
  // bg-app: hueSlot "surfaceApp" -> formulas.surfaceAppHueSlot ("canvas" dark | "text" light)
  "--tug-surface-global-primary-normal-app-rest": surface("surfaceApp", "surfaceAppBaseIntensity", "surfaceApp"),
  // bg-canvas: hueSlot "surfaceCanvas" -> formulas.surfaceCanvasHueSlot ("canvas" dark | "frame" light)
  "--tug-surface-global-primary-normal-canvas-rest": surface("surfaceCanvas", "surfaceCanvasIntensity", "surfaceCanvas"),
  // grid-rest: canvas hue at canvas tone ± 3 offset, very low intensity — barely visible grid lines
  "--tug-surface-global-primary-normal-grid-rest": surface("surfaceGrid", "surfaceGridIntensity", "surfaceGrid"),
  // surface-sunken: hueSlot "surfaceSunken" -> "canvasBase" dark | "frame" light
  "--tug-surface-global-primary-normal-sunken-rest": surface("surfaceSunken", "atmosphereIntensity", "surfaceSunken"),
  // surface-default: card body surface (hueSlot "surfaceCardBody" -> "card")
  "--tug-surface-global-primary-normal-default-rest": surface("surfaceCardBody", "cardBodyIntensity", "surfaceDefault"),
  // surface-raised: raised within card body (hueSlot "surfaceCardBody" -> "card")
  "--tug-surface-global-primary-normal-raised-rest": surface("surfaceCardBody", "cardBodyIntensity", "surfaceRaised"),
  // surface-overlay: overlay/modal (hueSlot "surfaceCardBody" -> "card")
  "--tug-surface-global-primary-normal-overlay-rest": surface("surfaceCardBody", "cardBodyIntensity", "surfaceOverlay"),
  // surface-inset: inset within card body (hueSlot "surfaceCardBody" -> "card")
  "--tug-surface-global-primary-normal-inset-rest": surface("surfaceCardBody", "cardBodyIntensity", "surfaceInset"),
  // surface-content: content area within card body (hueSlot "surfaceCardBody" -> "card")
  "--tug-surface-global-primary-normal-content-rest": surface("surfaceCardBody", "cardBodyIntensity", "surfaceContent"),
  // surface-screen: hueSlot "surfaceScreen" -> "canvasScreen" dark | "text" light
  "--tug-surface-global-primary-normal-screen-rest": surface("surfaceScreen", "surfaceScreenIntensity", "surfaceScreen"),
};

// ---------------------------------------------------------------------------
// A. Core Visual — Foreground / Text
// ---------------------------------------------------------------------------

const FOREGROUND_RULES: Record<string, DerivationRule> = {
  // fg-default: text hue (semantic text type: content — text slot resolves from element.content)
  "--tug-element-global-text-normal-default-rest": formulaField("text", "contentTextIntensity", "contentTextTone"),
  // fg-muted: informational hue (semantic text type: informational)
  "--tug-element-global-text-normal-muted-rest": formulaField("informational", "mutedTextIntensity", "mutedTextTone"),
  // fg-subtle: informational hue (semantic text type: informational)
  "--tug-element-global-text-normal-subtle-rest": formulaField("informational", "subtleTextIntensity", "subtleTextTone"),
  // fg-disabled: hueSlot "textDisabled" -> "textDisabled" dark | "text" light
  "--tug-element-global-text-normal-plain-disabled": formulaField("textDisabled", "subtleTextIntensity", "disabledTextTone"),
  // fg-inverse: textInverse hue (semantic text type: content — inverse text keeps content hue via derived slot)
  "--tug-element-global-text-normal-inverse-rest": formulaField("textInverse", "inverseTextIntensity", "inverseTextTone"),
  // fg-placeholder: hueSlot "textPlaceholder" -> "textPlaceholder" dark | "frame" light
  "--tug-element-global-text-normal-placeholder-rest": formulaField("textPlaceholder", "atmosphereBorderIntensity", "placeholderTextTone"),

  // fg-link: action hue, canonical i:50 t:50 (direct key)
  "--tug-element-global-text-normal-link-rest": {
    type: "chromatic",
    hueSlot: "action",
    intensityExpr: lit(50),
    toneExpr: lit(50),
  },

  // fg-link-hover: action hue, i:20 t:85 (= "cyan-light" preset)
  "--tug-element-global-text-normal-link-hover": {
    type: "chromatic",
    hueSlot: "action",
    intensityExpr: lit(20),
    toneExpr: lit(85),
  },

  // fg-onAccent: fgOnAccent hue (semantic text type: content — text on accent surfaces keeps content hue)
  "--tug-element-global-text-normal-onAccent-rest": formulaField("onAccentText", "contentTextIntensity", "inverseTextTone"),
  // fg-onDanger: same as fg-onAccent
  "--tug-element-global-text-normal-onDanger-rest": formulaField("onAccentText", "contentTextIntensity", "inverseTextTone"),

  // fg-onCaution: frame hue, formula I, literal t:7 (dark text on bright bg)
  "--tug-element-global-text-normal-onCaution-rest": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: (formulas) => formulas.onCautionTextIntensity,
    toneExpr: lit(7),
  },

  // fg-onSuccess: frame hue, formula I, literal t:7
  "--tug-element-global-text-normal-onSuccess-rest": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: (formulas) => formulas.onSuccessTextIntensity,
    toneExpr: lit(7),
  },
};

// ---------------------------------------------------------------------------
// A. Core Visual — Icon
// ---------------------------------------------------------------------------

const ICON_RULES: Record<string, DerivationRule> = {
  // icon-default: control hue (semantic text type: control — default icon is interactive context)
  "--tug-element-global-icon-normal-default-rest": formulaField("control", "mutedTextIntensity", "mutedTextTone"),
  // icon-muted: informational hue (semantic text type: informational — muted icon uses informational hue)
  "--tug-element-global-icon-normal-muted-rest": formulaField("informational", "iconMutedIntensity", "iconMutedTone"),
  // icon-disabled: same as fg-disabled
  "--tug-element-global-icon-normal-plain-disabled": formulaField("textDisabled", "subtleTextIntensity", "disabledTextTone"),

  // icon-active: control hue, literal i:100, formula tone — interactive active state
  "--tug-element-global-icon-normal-active-rest": {
    type: "chromatic",
    hueSlot: "control",
    intensityExpr: lit(100),
    toneExpr: (formulas) => formulas.iconActiveTone,
  },

  // icon-onAccent: iconOnAccent hue (semantic text type: content — on-accent icon keeps content hue via derived slot)
  "--tug-element-global-icon-normal-onAccent-rest": formulaField("iconOnAccent", "contentTextIntensity", "inverseTextTone"),
};

// ---------------------------------------------------------------------------
// A. Core Visual — Borders / Dividers
// ---------------------------------------------------------------------------

const BORDER_RULES: Record<string, DerivationRule> = {
  // border-default: borderTint hue at borderBaseIntensity, placeholderTextTone
  "--tug-element-global-border-normal-default-rest": formulaField("borderTint", "borderBaseIntensity", "placeholderTextTone"),
  // border-muted: borderTint hue at borderMutedIntensity, borderMutedTone
  "--tug-element-global-border-normal-muted-rest": formulaField("borderTint", "borderMutedIntensity", "borderMutedTone"),
  // border-strong: borderStrong hue (borderTint -5°) at borderStrongIntensity, borderStrongTone
  "--tug-element-global-border-normal-strong-rest": formulaField("borderStrong", "borderStrongIntensity", "borderStrongTone"),
  // border-inverse: text hue at contentTextIntensity, contentTextTone
  "--tug-element-global-border-normal-inverse-rest": formulaField("text", "contentTextIntensity", "contentTextTone"),

  // border-accent: accent hue at roleIntensity, t:50 (direct key — mode-independent)
  "--tug-element-global-border-normal-accent-rest": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: lit(50),
  },

  // border-danger: destructive hue at roleIntensity, t:50 (direct key — mode-independent)
  "--tug-element-global-border-normal-danger-rest": {
    type: "chromatic",
    hueSlot: "destructive",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: lit(50),
  },

  // divider-default: borderTint hue at dividerDefaultIntensity, dividerDefault
  "--tug-element-global-divider-normal-default-rest": {
    type: "chromatic",
    hueSlot: "borderTint",
    intensityExpr: (formulas) => formulas.dividerDefaultIntensity,
    toneExpr: (formulas) => formulas.dividerDefault,
  },

  // divider-muted: hueSlot "dividerMuted" -> "borderBase" dark | "borderTint" light
  "--tug-element-global-divider-normal-muted-rest": {
    type: "chromatic",
    hueSlot: "dividerMuted",
    intensityExpr: (formulas) => formulas.dividerMutedIntensity,
    toneExpr: (formulas) => formulas.dividerMuted,
  },
};

// ---------------------------------------------------------------------------
// A. Core Visual — Elevation / Overlay
// ---------------------------------------------------------------------------

const ELEVATION_RULES: Record<string, DerivationRule> = {
  "--tug-element-global-shadow-normal-xs-rest": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.shadowXsAlpha,
  },
  "--tug-element-global-shadow-normal-md-rest": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.shadowMdAlpha,
  },
  "--tug-element-global-shadow-normal-lg-rest": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.shadowLgAlpha,
  },
  "--tug-element-global-shadow-normal-xl-rest": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.shadowXlAlpha,
  },

  // shadow-overlay: composite value "0 4px 16px --tug-color(black, ...)"
  // Uses StructuralRule with resolvedExpr so resolved map is populated.
  "--tug-element-global-shadow-normal-overlay-rest": {
    type: "structural",
    valueExpr: (formulas) =>
      `0 4px 16px --tug-color(black, i: 0, t: 0, a: ${formulas.shadowOverlayAlpha})`,
    resolvedExpr: (formulas) => ({ L: 0, C: 0, h: 0, alpha: formulas.shadowOverlayAlpha / 100 }),
  },

  "--tug-surface-overlay-primary-normal-dim-rest": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.overlayDimAlpha,
  },
  "--tug-surface-overlay-primary-normal-scrim-rest": {
    type: "shadow",
    alphaExpr: (formulas) => formulas.overlayScrimAlpha,
  },

  // overlay-highlight: always verbose white form (i:0, t:100, a:N) per [D07] __verboseHighlight
  // Uses ChromaticRule with hueSlot "highlightVerbose" (direct sentinel — not formulas-mediated)
  "--tug-surface-overlay-primary-normal-highlight-rest": {
    type: "chromatic",
    hueSlot: "highlightVerbose",
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
  "--tug-font-family-sans": { type: "invariant", value: '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif' },
  "--tug-font-family-mono": { type: "invariant", value: '"Hack", "JetBrains Mono", "SFMono-Regular", "Menlo", monospace' },
  "--tug-font-size-2xs": { type: "invariant", value: "11px" },
  "--tug-font-size-xs": { type: "invariant", value: "12px" },
  "--tug-font-size-sm": { type: "invariant", value: "13px" },
  "--tug-font-size-md": { type: "invariant", value: "14px" },
  "--tug-font-size-lg": { type: "invariant", value: "16px" },
  "--tug-font-size-xl": { type: "invariant", value: "20px" },
  "--tug-font-size-2xl": { type: "invariant", value: "24px" },
  "--tug-line-height-2xs": { type: "invariant", value: "15px" },
  "--tug-line-height-xs": { type: "invariant", value: "17px" },
  "--tug-line-height-sm": { type: "invariant", value: "19px" },
  "--tug-line-height-md": { type: "invariant", value: "20px" },
  "--tug-line-height-lg": { type: "invariant", value: "24px" },
  "--tug-line-height-xl": { type: "invariant", value: "28px" },
  "--tug-line-height-2xl": { type: "invariant", value: "32px" },
  "--tug-line-height-tight": { type: "invariant", value: "1.2" },
  "--tug-line-height-normal": { type: "invariant", value: "1.45" },
  // Spacing
  "--tug-space-2xs": { type: "invariant", value: "2px" },
  "--tug-space-xs": { type: "invariant", value: "4px" },
  "--tug-space-sm": { type: "invariant", value: "6px" },
  "--tug-space-md": { type: "invariant", value: "8px" },
  "--tug-space-lg": { type: "invariant", value: "12px" },
  "--tug-space-xl": { type: "invariant", value: "16px" },
  "--tug-space-2xl": { type: "invariant", value: "24px" },
  // Radius
  "--tug-radius-2xs": { type: "invariant", value: "1px" },
  "--tug-radius-xs": { type: "invariant", value: "2px" },
  "--tug-radius-sm": { type: "invariant", value: "4px" },
  "--tug-radius-md": { type: "invariant", value: "6px" },
  "--tug-radius-lg": { type: "invariant", value: "8px" },
  "--tug-radius-xl": { type: "invariant", value: "12px" },
  "--tug-radius-2xl": { type: "invariant", value: "16px" },
  // Chrome
  "--tug-chrome-height": { type: "invariant", value: "36px" },
  // Icon sizes
  "--tug-icon-size-2xs": { type: "invariant", value: "10px" },
  "--tug-icon-size-xs": { type: "invariant", value: "12px" },
  "--tug-icon-size-sm": { type: "invariant", value: "13px" },
  "--tug-icon-size-md": { type: "invariant", value: "15px" },
  "--tug-icon-size-lg": { type: "invariant", value: "20px" },
  "--tug-icon-size-xl": { type: "invariant", value: "24px" },
  // Motion
  "--tug-motion-duration-fast": { type: "invariant", value: "calc(100ms * var(--tug-timing))" },
  "--tug-motion-duration-moderate": { type: "invariant", value: "calc(200ms * var(--tug-timing))" },
  "--tug-motion-duration-slow": { type: "invariant", value: "calc(350ms * var(--tug-timing))" },
  "--tug-motion-duration-glacial": { type: "invariant", value: "calc(500ms * var(--tug-timing))" },
  "--tug-motion-duration-instant": { type: "invariant", value: "calc(0ms * var(--tug-timing))" },
  "--tug-motion-easing-standard": { type: "invariant", value: "cubic-bezier(0.2, 0, 0, 1)" },
  "--tug-motion-easing-enter": { type: "invariant", value: "cubic-bezier(0, 0, 0, 1)" },
  "--tug-motion-easing-exit": { type: "invariant", value: "cubic-bezier(0.2, 0, 1, 1)" },
  // Control disabled opacity (invariant — always 50% regardless of mode or theme)
  "--tug-control-disabled-opacity": { type: "invariant", value: "0.5" },
};

// ---------------------------------------------------------------------------
// A. Core Visual — Card Title (display semantic text type)
// ---------------------------------------------------------------------------

const CARD_TITLE_RULES: Record<string, DerivationRule> = {
  // card-title: display hue (semantic text type: display — card titles are display text)
  "--tug-element-cardTitle-text-normal-plain-rest": formulaField("display", "contentTextIntensity", "contentTextTone"),
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
  ...CARD_TITLE_RULES,
  ...ICON_RULES,
  ...BORDER_RULES,
  ...ELEVATION_RULES,
  ...INVARIANT_RULES,
};

// ---------------------------------------------------------------------------
// B. Accent System
// ---------------------------------------------------------------------------

const ACCENT_RULES: Record<string, DerivationRule> = {
  // accent-default: accent hue at roleIntensity, t:50
  "--tug-element-global-fill-normal-accent-rest": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: lit(50),
  },

  // accent-subtle: accent hue at roleIntensity, accentSubtleTone, a:10
  // tone driven by formula field: dark=30 (darker orange so composited surface over dark parent
  // gives fg-default contrast ≥75), light=50 (standard mid-tone, easily passes on bright bg).
  // alpha kept at 10 (reduced from 15) as an additional contribution.
  "--tug-element-global-fill-normal-accentSubtle-rest": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: (f: F) => f.accentSubtleTone,
    alphaExpr: lit(10),
  },

  // accent-cool-default: text hue at i:90, t:50 (cobalt-intense)
  "--tug-element-global-fill-normal-accentCool-rest": {
    type: "chromatic",
    hueSlot: "text",
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
  return {
    [`--tug-element-tone-fill-normal-${family}-rest`]: semanticTone()(hueSlot),
    [`--tug-surface-tone-primary-normal-${family}-rest`]: semanticTone(bgAlpha)(hueSlot),
    [`--tug-element-tone-text-normal-${family}-rest`]: semanticTone()(hueSlot),
    [`--tug-element-tone-border-normal-${family}-rest`]: semanticTone()(hueSlot),
    [`--tug-element-tone-icon-normal-${family}-rest`]: semanticTone()(hueSlot),
  };
}

const SEMANTIC_TONE_RULES: Record<string, DerivationRule> = {
  ...semanticToneFamilyRules("accent", "accent", 15),
  ...semanticToneFamilyRules("active", "action", 15),
  ...semanticToneFamilyRules("agent", "agent", 15),
  ...semanticToneFamilyRules("data", "data", 15),
  ...semanticToneFamilyRules("success", "success", 15),
  ...semanticToneFamilyRules("caution", "caution", 8),
  // tone-caution-bg uses formula field cautionSurfaceTone instead of semanticRoleTone.
  // Dark: cautionSurfaceTone=30 (darker yellow so fg-default achieves contrast ≥75 composited over
  // dark parent surface at low alpha). Light: cautionSurfaceTone=35 (matches semanticRoleTone).
  // Override spreads the family first, then overrides only the bg rule.
  "--tug-surface-tone-primary-normal-caution-rest": {
    type: "chromatic",
    hueSlot: "caution",
    intensityExpr: (formulas: F) => formulas.roleIntensity,
    toneExpr: (f: F) => f.cautionSurfaceTone,
    alphaExpr: lit(8),
  },
  ...semanticToneFamilyRules("danger", "destructive", 15),
};

// ---------------------------------------------------------------------------
// D. Selection / Highlight / Preview
// ---------------------------------------------------------------------------

const SELECTION_RULES: Record<string, DerivationRule> = {
  // selection-bg: action hue at i:50, t:50, a:40
  "--tug-surface-selection-primary-normal-plain-rest": {
    type: "chromatic",
    hueSlot: "action",
    intensityExpr: lit(50),
    toneExpr: lit(50),
    alphaExpr: lit(40),
  },

  // selection-bg-inactive: hueSlot "selectionInactive" -> yellow (dark) | atm-20° (light)
  // Dark: i:0, t:30, a:25; Light: i:8, t:24, a:20
  "--tug-surface-selection-primary-normal-plain-inactive": {
    type: "chromatic",
    hueSlot: "selectionInactive",
    intensityExpr: (formulas) => formulas.selectionSurfaceInactiveIntensity,
    toneExpr: (formulas) => formulas.selectionSurfaceInactiveTone,
    alphaExpr: (formulas) => formulas.selectionSurfaceInactiveAlpha,
  },

  // selection-fg: text hue at contentTextIntensity, contentTextTone
  "--tug-element-selection-text-normal-plain-rest": {
    type: "chromatic",
    hueSlot: "text",
    intensityExpr: (formulas) => formulas.contentTextIntensity,
    toneExpr: (formulas) => formulas.contentTextTone,
  },

  // highlight-hover: "highlightVerbose" dark (i:0, t:100, a:5) | "shadow" light (a:4)
  // Formulas-mediated via highlightHoverHueSlot
  "--tug-surface-highlight-primary-normal-hover-rest": {
    type: "chromatic",
    hueSlot: "highlightHover",
    intensityExpr: lit(0),
    toneExpr: lit(100),
    alphaExpr: (formulas) => formulas.highlightHoverAlpha,
  },

  // highlight-dropTarget: action hue at i:50, t:50, a:18
  "--tug-surface-highlight-primary-normal-dropTarget-rest": {
    type: "chromatic",
    hueSlot: "action",
    intensityExpr: lit(50),
    toneExpr: lit(50),
    alphaExpr: lit(18),
  },

  // highlight-preview: action hue at i:50, t:50, a:12
  "--tug-surface-highlight-primary-normal-preview-rest": {
    type: "chromatic",
    hueSlot: "action",
    intensityExpr: lit(50),
    toneExpr: lit(50),
    alphaExpr: lit(12),
  },

  // highlight-inspectorTarget: action hue at i:50, t:50, a:22
  "--tug-surface-highlight-primary-normal-inspectorTarget-rest": {
    type: "chromatic",
    hueSlot: "action",
    intensityExpr: lit(50),
    toneExpr: lit(50),
    alphaExpr: lit(22),
  },

  // highlight-snapGuide: action hue at i:50, t:50, a:50
  "--tug-surface-highlight-primary-normal-snapGuide-rest": {
    type: "chromatic",
    hueSlot: "action",
    intensityExpr: lit(50),
    toneExpr: lit(50),
    alphaExpr: lit(50),
  },

  // highlight-flash: accent hue at roleIntensity, t:50, a:35
  "--tug-surface-highlight-primary-normal-flash-rest": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: lit(50),
    alphaExpr: lit(35),
  },
};

// ---------------------------------------------------------------------------
// D2. Tab Chrome
// ---------------------------------------------------------------------------

const TAB_CHROME_RULES: Record<string, DerivationRule> = {
  // tab-bg-active: hueSlot "tabSurfaceActive" -> "frame" (same in both modes)
  "--tug-surface-tab-primary-normal-plain-active": {
    type: "chromatic",
    hueSlot: "tabSurfaceActive",
    intensityExpr: (formulas) => formulas.cardFrameActiveIntensity,
    toneExpr: (formulas) => formulas.cardFrameActiveTone,
  },

  // tab-bg-inactive: hueSlot "tabSurfaceInactive" -> "frame" (same in both modes)
  "--tug-surface-tab-primary-normal-plain-inactive": {
    type: "chromatic",
    hueSlot: "tabSurfaceInactive",
    intensityExpr: (formulas) => formulas.cardFrameInactiveIntensity,
    toneExpr: (formulas) => formulas.cardFrameInactiveTone,
  },

  // tab-bg-collapsed: always frame hue at inactive intensity/tone
  "--tug-surface-tab-primary-normal-plain-collapsed": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: (formulas) => formulas.cardFrameInactiveIntensity,
    toneExpr: (formulas) => formulas.cardFrameInactiveTone,
  },

  // tab-bg-hover: "highlight" dark (a:8) | "shadow" light (a:6)
  // Formulas-mediated via tabSurfaceHoverHueSlot
  "--tug-surface-tab-primary-normal-plain-hover": {
    type: "chromatic",
    hueSlot: "tabSurfaceHover",
    intensityExpr: lit(0),
    toneExpr: lit(0),
    alphaExpr: (formulas) => formulas.tabSurfaceHoverAlpha,
  },

  // tab-fg-rest: control hue at subtleTextIntensity, t:50 (canonical — tab labels are control text)
  "--tug-element-tab-text-normal-plain-rest": {
    type: "chromatic",
    hueSlot: "control",
    intensityExpr: (formulas) => formulas.subtleTextIntensity,
    toneExpr: lit(50),
  },

  // tab-fg-hover: control hue at contentTextIntensity, tabTextActiveTone (tab labels are control text)
  "--tug-element-tab-text-normal-plain-hover": {
    type: "chromatic",
    hueSlot: "control",
    intensityExpr: (formulas) => formulas.contentTextIntensity,
    toneExpr: (formulas) => formulas.tabTextActiveTone,
  },

  // tab-fg-active: same as tab-fg-hover
  "--tug-element-tab-text-normal-plain-active": {
    type: "chromatic",
    hueSlot: "control",
    intensityExpr: (formulas) => formulas.contentTextIntensity,
    toneExpr: (formulas) => formulas.tabTextActiveTone,
  },

  // tab-close-bg-hover: "highlight" dark (a:12) | "shadow" light (a:10)
  // Formulas-mediated via tabCloseSurfaceHoverHueSlot
  "--tug-surface-tabClose-primary-normal-plain-hover": {
    type: "chromatic",
    hueSlot: "tabCloseSurfaceHover",
    intensityExpr: lit(0),
    toneExpr: lit(0),
    alphaExpr: (formulas) => formulas.tabCloseSurfaceHoverAlpha,
  },

  // tab-close-fg-hover: control hue — tab close button is a control element
  "--tug-element-tabClose-text-normal-plain-hover": {
    type: "chromatic",
    hueSlot: "control",
    intensityExpr: (formulas) => formulas.contentTextIntensity,
    toneExpr: (formulas) => formulas.tabTextActiveTone,
  },
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Disabled
// ---------------------------------------------------------------------------

const DISABLED_RULES: Record<string, DerivationRule> = {
  // disabled-bg: hueSlot "disabledSurface" -> "canvasBase" dark | "frame" light
  "--tug-surface-control-primary-normal-plain-disabled": {
    type: "chromatic",
    hueSlot: "disabledSurface",
    intensityExpr: (formulas) => formulas.disabledSurfaceIntensity,
    toneExpr: (formulas) => formulas.disabledSurfaceTone,
  },

  // disabled-fg: textDisabled hue at subtleTextIntensity, disabledTextTone
  "--tug-element-control-text-normal-plain-disabled": {
    type: "chromatic",
    hueSlot: "textDisabled",
    intensityExpr: (formulas) => formulas.subtleTextIntensity,
    toneExpr: (formulas) => formulas.disabledTextToneComputed,
  },

  // disabled-border: frame hue at disabledBorderIntensity, disabledBorderTone
  "--tug-element-control-border-normal-plain-disabled": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: (formulas) => formulas.disabledBorderIntensity,
    toneExpr: (formulas) => formulas.disabledBorderTone,
  },

  // disabled-icon: same as disabled-fg
  "--tug-element-control-icon-normal-plain-disabled": {
    type: "chromatic",
    hueSlot: "textDisabled",
    intensityExpr: (formulas) => formulas.subtleTextIntensity,
    toneExpr: (formulas) => formulas.disabledTextToneComputed,
  },

  // disabled-shadow: structural "none"
  "--tug-element-control-shadow-normal-plain-disabled": {
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
 *   rest:   hueSlot at i:50, t:filledSurfaceRestTone
 *   hover:  hueSlot at i:55, t:filledSurfaceHoverTone
 *   active: hueSlot at i:90, t:filledSurfaceActiveTone
 *
 * fg/icon formula (txt hue, light text on dark bg):
 *   all states: txt at Math.max(1, contentTextIntensity-1), t:100
 *
 * border formula:
 *   rest:   hueSlot at Math.min(90, roleIntensity+5), t:50
 *   hover:  hueSlot at Math.min(90, roleIntensity+15), t:50
 *   active: hueSlot at i:90, t:filledSurfaceActiveTone  (same as filledBgActive)
 */
function filledRoleRules(role: string, hueSlot: string): Record<string, DerivationRule> {
  return {
    // bg (surface)
    [`--tug-surface-control-primary-filled-${role}-rest`]: filledBgRest(hueSlot),
    [`--tug-surface-control-primary-filled-${role}-hover`]: filledBgHover(hueSlot),
    [`--tug-surface-control-primary-filled-${role}-active`]: filledBgActive(hueSlot),
    // fg (element text)
    [`--tug-element-control-text-filled-${role}-rest`]: filledFg(),
    [`--tug-element-control-text-filled-${role}-hover`]: filledFg(),
    [`--tug-element-control-text-filled-${role}-active`]: filledFg(),
    // border (element border)
    [`--tug-element-control-border-filled-${role}-rest`]: borderRest(hueSlot),
    [`--tug-element-control-border-filled-${role}-hover`]: borderHover(hueSlot),
    [`--tug-element-control-border-filled-${role}-active`]: filledBgActive(hueSlot),
    // icon (element icon)
    [`--tug-element-control-icon-filled-${role}-rest`]: filledFg(),
    [`--tug-element-control-icon-filled-${role}-hover`]: filledFg(),
    [`--tug-element-control-icon-filled-${role}-active`]: filledFg(),
  };
}

const FILLED_RULES: Record<string, DerivationRule> = {
  ...filledRoleRules("accent", "accent"),
  ...filledRoleRules("action", "action"),
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
// border: role hue at roleIntensity+5/+15/+25
// ---------------------------------------------------------------------------

/**
 * Build outlined-{role} rules for any role.
 *
 * bg-rest: transparent
 * bg-hover/active: sentinel hue slot with formula-driven intensity/alpha
 * fg/icon: role hue at emphasis-level tone/intensity
 * border: role hue at roleIntensity ramp
 */
function outlinedRoleRules(role: string, hueSlot: string): Record<string, DerivationRule> {
  return {
    // bg (surface)
    [`--tug-surface-control-primary-outlined-${role}-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`--tug-surface-control-primary-outlined-${role}-hover`]: outlinedBg("outlinedSurfaceHoverIntensity", "outlinedSurfaceHoverTone", "outlinedSurfaceHoverAlpha")("outlinedSurfaceHover"),
    [`--tug-surface-control-primary-outlined-${role}-active`]: outlinedBg("outlinedSurfaceActiveIntensity", "outlinedSurfaceActiveTone", "outlinedSurfaceActiveAlpha")("outlinedSurfaceActive"),
    // fg — role hue, emphasis-level tone/intensity
    [`--tug-element-control-text-outlined-${role}-rest`]: outlinedFg("outlinedTextIntensity", "outlinedTextRestTone", hueSlot),
    [`--tug-element-control-text-outlined-${role}-hover`]: outlinedFg("outlinedTextIntensity", "outlinedTextHoverTone", hueSlot),
    [`--tug-element-control-text-outlined-${role}-active`]: outlinedFg("outlinedTextIntensity", "outlinedTextActiveTone", hueSlot),
    // border — role hue at roleIntensity ramp
    [`--tug-element-control-border-outlined-${role}-rest`]: borderRest(hueSlot),
    [`--tug-element-control-border-outlined-${role}-hover`]: borderHover(hueSlot),
    [`--tug-element-control-border-outlined-${role}-active`]: borderActive(hueSlot),
    // icon — role hue, emphasis-level tone/intensity
    [`--tug-element-control-icon-outlined-${role}-rest`]: outlinedFg("outlinedIconIntensity", "outlinedIconRestTone", hueSlot),
    [`--tug-element-control-icon-outlined-${role}-hover`]: outlinedFg("outlinedIconIntensity", "outlinedIconHoverTone", hueSlot),
    [`--tug-element-control-icon-outlined-${role}-active`]: outlinedFg("outlinedIconIntensity", "outlinedIconActiveTone", hueSlot),
  };
}

// Outlined-option overrides: neutral control-hue borders instead of role-colored.
function outlinedOptionBorderRules(): Record<string, DerivationRule> {
  return {
    "--tug-element-control-border-outlined-option-rest": {
      type: "chromatic",
      hueSlot: "control",
      intensityExpr: (formulas) => formulas.subtleTextIntensity,
      toneExpr: (formulas) => formulas.outlinedOptionBorderRestTone,
    },
    "--tug-element-control-border-outlined-option-hover": {
      type: "chromatic",
      hueSlot: "control",
      intensityExpr: (formulas) => Math.min(90, formulas.subtleTextIntensity + 2),
      toneExpr: (formulas) => formulas.outlinedOptionBorderHoverTone,
    },
    "--tug-element-control-border-outlined-option-active": {
      type: "chromatic",
      hueSlot: "control",
      intensityExpr: (formulas) => Math.min(90, formulas.subtleTextIntensity + 4),
      toneExpr: (formulas) => formulas.outlinedOptionBorderActiveTone,
    },
  };
}

const OUTLINED_RULES: Record<string, DerivationRule> = {
  ...outlinedRoleRules("accent", "accent"),
  ...outlinedRoleRules("action", "action"),
  ...outlinedRoleRules("danger", "destructive"),
  ...outlinedRoleRules("agent", "agent"),
  ...outlinedRoleRules("data", "data"),
  ...outlinedRoleRules("success", "success"),
  ...outlinedRoleRules("caution", "caution"),
  ...outlinedRoleRules("option", "action"),
  // Override outlined-option borders with neutral formulas
  ...outlinedOptionBorderRules(),
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Ghost roles (all 7 + option)
// ---------------------------------------------------------------------------

/**
 * Build ghost-{role} rules for any role.
 *
 * bg-rest/border-rest: transparent
 * bg-hover/active: sentinel hue slot with formula-driven alpha
 * fg/icon: role hue at emphasis-level tone/intensity
 * border-hover/active: role hue at ghostBorderIntensity, ghostBorderTone
 */
function ghostRoleRules(role: string, hueSlot: string): Record<string, DerivationRule> {
  return {
    // bg (surface)
    [`--tug-surface-control-primary-ghost-${role}-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`--tug-surface-control-primary-ghost-${role}-hover`]: ghostBg((f) => f.ghostSurfaceHoverAlpha)("ghostSurfaceHover"),
    [`--tug-surface-control-primary-ghost-${role}-active`]: ghostBg((f) => f.ghostSurfaceActiveAlpha)("ghostSurfaceActive"),
    // fg — role hue, emphasis-level tone/intensity
    [`--tug-element-control-text-ghost-${role}-rest`]: outlinedFg("ghostTextRestIntensity", "ghostTextRestTone", hueSlot),
    [`--tug-element-control-text-ghost-${role}-hover`]: outlinedFg("ghostTextHoverIntensity", "ghostTextHoverTone", hueSlot),
    [`--tug-element-control-text-ghost-${role}-active`]: outlinedFg("ghostTextActiveIntensity", "ghostTextActiveTone", hueSlot),
    // border
    [`--tug-element-control-border-ghost-${role}-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`--tug-element-control-border-ghost-${role}-hover`]: outlinedFg("ghostBorderIntensity", "ghostBorderTone", hueSlot),
    [`--tug-element-control-border-ghost-${role}-active`]: outlinedFg("ghostBorderIntensity", "ghostBorderTone", hueSlot),
    // icon — role hue, emphasis-level tone/intensity
    [`--tug-element-control-icon-ghost-${role}-rest`]: outlinedFg("ghostIconRestIntensity", "ghostIconRestTone", hueSlot),
    [`--tug-element-control-icon-ghost-${role}-hover`]: outlinedFg("ghostIconHoverIntensity", "ghostIconHoverTone", hueSlot),
    [`--tug-element-control-icon-ghost-${role}-active`]: outlinedFg("ghostIconActiveIntensity", "ghostIconActiveTone", hueSlot),
  };
}

const GHOST_RULES: Record<string, DerivationRule> = {
  ...ghostRoleRules("accent", "accent"),
  ...ghostRoleRules("action", "action"),
  ...ghostRoleRules("danger", "destructive"),
  ...ghostRoleRules("agent", "agent"),
  ...ghostRoleRules("data", "data"),
  ...ghostRoleRules("success", "success"),
  ...ghostRoleRules("caution", "caution"),
  ...ghostRoleRules("option", "action"),
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Selected / Highlighted / Surface Control
// ---------------------------------------------------------------------------

const SELECTED_HIGHLIGHTED_RULES: Record<string, DerivationRule> = {
  // surface-control: alias to outlined-action-bg-rest (transparent)
  "--tug-surface-global-primary-normal-control-rest": {
    type: "structural",
    valueExpr: () => "var(--tug-surface-control-primary-outlined-action-rest)",
  },

  // selected tokens
  "--tug-surface-control-primary-normal-selected-rest": { type: "chromatic", hueSlot: "action", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(18) },
  "--tug-surface-control-primary-normal-selected-hover": { type: "chromatic", hueSlot: "action", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(24) },
  "--tug-element-control-text-normal-selected-rest": { type: "chromatic", hueSlot: "control", intensityExpr: (formulas) => formulas.contentTextIntensity, toneExpr: (formulas) => formulas.contentTextTone },
  "--tug-element-control-border-normal-selected-rest": { type: "chromatic", hueSlot: "action", intensityExpr: lit(50), toneExpr: lit(50) },
  "--tug-surface-control-primary-normal-selected-disabled": { type: "chromatic", hueSlot: "action", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(10) },

  // highlighted tokens
  "--tug-surface-control-primary-normal-highlighted-rest": { type: "chromatic", hueSlot: "action", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(10) },
  "--tug-element-control-text-normal-highlighted-rest": { type: "chromatic", hueSlot: "control", intensityExpr: (formulas) => formulas.contentTextIntensity, toneExpr: (formulas) => formulas.contentTextTone },
  "--tug-element-control-border-normal-highlighted-rest": { type: "chromatic", hueSlot: "action", intensityExpr: lit(50), toneExpr: lit(50), alphaExpr: lit(25) },
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Field tokens
// ---------------------------------------------------------------------------

const FIELD_RULES: Record<string, DerivationRule> = {
  // field-bg-rest: frame hue; dark: i=atmosphereIntensity; light: i=fieldSurfaceRestIntensity (7)
  "--tug-surface-field-primary-normal-plain-rest": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: (formulas) => formulas.fieldSurfaceRestIntensity,
    toneExpr: (formulas) => formulas.fieldSurfaceRestTone,
  },

  // field-bg-hover: hueSlot "fieldSurfaceHover" -> "canvasBase" dark | "frame" light
  "--tug-surface-field-primary-normal-plain-hover": {
    type: "chromatic",
    hueSlot: "fieldSurfaceHover",
    intensityExpr: (formulas) => formulas.atmosphereIntensity,
    toneExpr: (formulas) => formulas.fieldSurfaceHoverTone,
  },

  // field-bg-focus: frame hue at i:4, fieldSurfaceFocusTone
  "--tug-surface-field-primary-normal-plain-focus": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: lit(4),
    toneExpr: (formulas) => formulas.fieldSurfaceFocusTone,
  },

  // field-bg-disabled: frame hue at atmosphereIntensity, fieldSurfaceDisabledTone
  "--tug-surface-field-primary-normal-plain-disabled": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: (formulas) => formulas.atmosphereIntensity,
    toneExpr: (formulas) => formulas.fieldSurfaceDisabledTone,
  },

  // field-bg-readOnly: hueSlot "fieldSurfaceReadOnly" -> "canvasBase" dark | "frame" light
  "--tug-surface-field-primary-normal-plain-readOnly": {
    type: "chromatic",
    hueSlot: "fieldSurfaceReadOnly",
    intensityExpr: (formulas) => formulas.atmosphereIntensity,
    toneExpr: (formulas) => formulas.fieldSurfaceReadOnlyTone,
  },

  // field-fg-default: text hue at contentTextIntensity, contentTextTone (user-typed text is content)
  "--tug-element-field-text-normal-plain-rest": {
    type: "chromatic",
    hueSlot: "text",
    intensityExpr: (formulas) => formulas.contentTextIntensity,
    toneExpr: (formulas) => formulas.contentTextTone,
  },

  // field-fg-disabled: textDisabled hue at subtleTextIntensity, disabledTextTone
  "--tug-element-field-text-normal-plain-disabled": {
    type: "chromatic",
    hueSlot: "textDisabled",
    intensityExpr: (formulas) => formulas.subtleTextIntensity,
    toneExpr: (formulas) => formulas.disabledTextTone,
  },

  // field-fg-readOnly: textMuted hue at mutedTextIntensity, mutedTextTone
  "--tug-element-field-text-normal-plain-readOnly": {
    type: "chromatic",
    hueSlot: "textMuted",
    intensityExpr: (formulas) => formulas.mutedTextIntensity,
    toneExpr: (formulas) => formulas.mutedTextTone,
  },

  // field-fg-placeholder: hueSlot "fieldPlaceholder" -> "textPlaceholder" dark | "frame" light
  "--tug-element-field-text-normal-placeholder-rest": {
    type: "chromatic",
    hueSlot: "fieldPlaceholder",
    intensityExpr: (formulas) => formulas.atmosphereBorderIntensity,
    toneExpr: (formulas) => formulas.placeholderTextTone,
  },

  // field-border-rest: hueSlot "fieldBorderRest" -> "textPlaceholder" dark | "frame" light
  "--tug-element-field-border-normal-plain-rest": {
    type: "chromatic",
    hueSlot: "fieldBorderRest",
    intensityExpr: (formulas) => formulas.atmosphereBorderIntensity,
    toneExpr: (formulas) => formulas.placeholderTextTone,
  },

  // field-border-hover: hueSlot "fieldBorderHover" -> "textSubtle" dark | "borderStrong" light
  // borderStrongToneComputed is the unified field (dark: subtleTextTone; light: borderStrongTone)
  "--tug-element-field-border-normal-plain-hover": {
    type: "chromatic",
    hueSlot: "fieldBorderHover",
    intensityExpr: (formulas) => formulas.borderStrongIntensity,
    toneExpr: (formulas) => formulas.borderStrongToneComputed,
  },

  // field-border-active: action hue at canonical i:50, t:50
  "--tug-element-field-border-normal-plain-active": {
    type: "chromatic",
    hueSlot: "action",
    intensityExpr: lit(50),
    toneExpr: lit(50),
  },

  // field-border-danger: destructive hue at roleIntensity, t:50
  "--tug-element-field-border-normal-danger-rest": {
    type: "chromatic",
    hueSlot: "destructive",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: lit(50),
  },

  // field-border-success: success hue at roleIntensity, t:50
  "--tug-element-field-border-normal-success-rest": {
    type: "chromatic",
    hueSlot: "success",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: lit(50),
  },

  // field-border-disabled: frame hue at atmosphereBorderIntensity, dividerDefault
  "--tug-element-field-border-normal-plain-disabled": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: (formulas) => formulas.atmosphereBorderIntensity,
    toneExpr: (formulas) => formulas.dividerDefault,
  },

  // field-border-readOnly: frame hue at atmosphereBorderIntensity, dividerDefault
  "--tug-element-field-border-normal-plain-readOnly": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: (formulas) => formulas.atmosphereBorderIntensity,
    toneExpr: (formulas) => formulas.dividerDefault,
  },

  // field-fg-label: control hue at contentTextIntensity, contentTextTone (field labels are control text)
  "--tug-element-field-text-normal-label-rest": {
    type: "chromatic",
    hueSlot: "control",
    intensityExpr: (formulas) => formulas.contentTextIntensity,
    toneExpr: (formulas) => formulas.contentTextTone,
  },

  // field-fg-required: destructive hue at roleIntensity, t:50
  "--tug-element-field-text-normal-required-rest": {
    type: "chromatic",
    hueSlot: "destructive",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: lit(50),
  },

  // field-tone-danger: destructive hue at roleIntensity, t:50
  "--tug-element-field-fill-normal-danger-rest": {
    type: "chromatic",
    hueSlot: "destructive",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: lit(50),
  },

  // field-tone-caution: caution hue at roleIntensity, t:50
  "--tug-element-field-fill-normal-caution-rest": {
    type: "chromatic",
    hueSlot: "caution",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: lit(50),
  },

  // field-tone-success: success hue at roleIntensity, t:50
  "--tug-element-field-fill-normal-success-rest": {
    type: "chromatic",
    hueSlot: "success",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: lit(50),
  },
};

// ---------------------------------------------------------------------------
// E. Control Surfaces — Toggle / Range
// ---------------------------------------------------------------------------

const TOGGLE_RULES: Record<string, DerivationRule> = {
  // toggle-track-off: frame hue at atmosphereBorderIntensity, toggleTrackOffTone
  "--tug-surface-toggle-track-normal-off-rest": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: (formulas) => formulas.atmosphereBorderIntensity,
    toneExpr: (formulas) => formulas.toggleTrackOffTone,
  },

  // toggle-track-off-hover: frame hue at min(atmosphereBorderIntensity+4,100), min(toggleTrackOffTone+8,100)
  "--tug-surface-toggle-track-normal-off-hover": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: (formulas) => Math.min(formulas.atmosphereBorderIntensity + 4, 100),
    toneExpr: (formulas) => Math.min(formulas.toggleTrackOffTone + 8, 100),
  },

  // toggle-track-on: accent hue at roleIntensity, t:42 (muted preset)
  "--tug-surface-toggle-track-normal-on-rest": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (formulas) => formulas.roleIntensity,
    toneExpr: lit(42),
  },

  // toggle-track-on-hover: accent hue at min(roleIntensity+5,100), toggleTrackOnHoverTone
  "--tug-surface-toggle-track-normal-on-hover": {
    type: "chromatic",
    hueSlot: "accent",
    intensityExpr: (formulas) => Math.min(formulas.roleIntensity + 5, 100),
    toneExpr: (formulas) => formulas.toggleTrackOnHoverTone,
  },

  // toggle-track-disabled: hueSlot "toggleTrackDisabled" -> "canvasBase" dark | "frame" light
  "--tug-surface-toggle-track-normal-plain-disabled": {
    type: "chromatic",
    hueSlot: "toggleTrackDisabled",
    intensityExpr: (formulas) => formulas.toggleTrackDisabledIntensity,
    toneExpr: (formulas) => formulas.toggleDisabledTone,
  },

  // toggle-track-mixed: textSubtle hue at subtleTextIntensity, subtleTextTone
  "--tug-surface-toggle-track-normal-mixed-rest": {
    type: "chromatic",
    hueSlot: "textSubtle",
    intensityExpr: (formulas) => formulas.subtleTextIntensity,
    toneExpr: (formulas) => formulas.subtleTextTone,
  },

  // toggle-track-mixed-hover: textSubtle hue at min(subtleTextIntensity+5,100), min(subtleTextTone+6,100)
  "--tug-surface-toggle-track-normal-mixed-hover": {
    type: "chromatic",
    hueSlot: "textSubtle",
    intensityExpr: (formulas) => Math.min(formulas.subtleTextIntensity + 5, 100),
    toneExpr: (formulas) => Math.min(formulas.subtleTextTone + 6, 100),
  },

  // toggle-thumb: hueSlot "toggleThumb" -> "textInverse" dark | "white" light
  "--tug-element-toggle-thumb-normal-plain-rest": {
    type: "chromatic",
    hueSlot: "toggleThumb",
    intensityExpr: (formulas) => formulas.contentTextIntensity,
    toneExpr: (formulas) => formulas.inverseTextTone,
  },

  // toggle-thumb-disabled: textDisabled hue at subtleTextIntensity, toggleThumbDisabledTone
  "--tug-element-toggle-thumb-normal-plain-disabled": {
    type: "chromatic",
    hueSlot: "textDisabled",
    intensityExpr: (formulas) => formulas.subtleTextIntensity,
    toneExpr: (formulas) => formulas.toggleThumbDisabledTone,
  },

  // toggle-icon-disabled: textDisabled hue at subtleTextIntensity, toggleThumbDisabledTone
  "--tug-element-toggle-icon-normal-plain-disabled": {
    type: "chromatic",
    hueSlot: "textDisabled",
    intensityExpr: (formulas) => formulas.subtleTextIntensity,
    toneExpr: (formulas) => formulas.toggleThumbDisabledTone,
  },

  // toggle-icon-mixed: textMuted hue at mutedTextIntensity, mutedTextTone
  "--tug-element-toggle-icon-normal-plain-mixed": {
    type: "chromatic",
    hueSlot: "textMuted",
    intensityExpr: (formulas) => formulas.mutedTextIntensity,
    toneExpr: (formulas) => formulas.mutedTextTone,
  },

  // checkmark-fg: hueSlot "checkmark" -> "textInverse" dark | "white" light
  "--tug-element-checkmark-icon-normal-plain-rest": {
    type: "chromatic",
    hueSlot: "checkmark",
    intensityExpr: (formulas) => formulas.contentTextIntensity,
    toneExpr: (formulas) => formulas.inverseTextTone,
  },

  // checkmark-fg-mixed: textMuted hue at mutedTextIntensity, mutedTextTone
  "--tug-element-checkmark-icon-normal-plain-mixed": {
    type: "chromatic",
    hueSlot: "textMuted",
    intensityExpr: (formulas) => formulas.mutedTextIntensity,
    toneExpr: (formulas) => formulas.mutedTextTone,
  },

  // radio-dot: hueSlot "radioDot" -> "textInverse" dark | "white" light
  "--tug-element-radio-dot-normal-plain-rest": {
    type: "chromatic",
    hueSlot: "radioDot",
    intensityExpr: (formulas) => formulas.contentTextIntensity,
    toneExpr: (formulas) => formulas.inverseTextTone,
  },

  // divider-separator: frame hue at atmosphereBorderIntensity, toggleTrackOffTone
  "--tug-element-global-divider-normal-separator-rest": {
    type: "chromatic",
    hueSlot: "frame",
    intensityExpr: (formulas) => formulas.atmosphereBorderIntensity,
    toneExpr: (formulas) => formulas.toggleTrackOffTone,
  },

};

// ---------------------------------------------------------------------------
// F. Badge Tinted — factory helper
// 7 roles × 3 properties (fg, bg, border) = 21 tokens
// ---------------------------------------------------------------------------

/**
 * Build 3 badge-tinted tokens for a role.
 * FG: role hue at badgeTintedTextIntensity, badgeTintedTextTone (alpha=100)
 * BG: role hue at badgeTintedSurfaceIntensity, badgeTintedSurfaceTone, alpha=badgeTintedSurfaceAlpha
 * Border: role hue at badgeTintedBorderIntensity, badgeTintedBorderTone, alpha=badgeTintedBorderAlpha
 */
function badgeTintedRoleRules(role: string, hueSlot: string): Record<string, DerivationRule> {
  return {
    [`--tug-element-badge-text-tinted-${role}-rest`]: badgeTinted("badgeTintedTextIntensity", "badgeTintedTextTone")(hueSlot),
    [`--tug-surface-badge-primary-tinted-${role}-rest`]: badgeTinted("badgeTintedSurfaceIntensity", "badgeTintedSurfaceTone", "badgeTintedSurfaceAlpha")(hueSlot),
    [`--tug-element-badge-border-tinted-${role}-rest`]: badgeTinted("badgeTintedBorderIntensity", "badgeTintedBorderTone", "badgeTintedBorderAlpha")(hueSlot),
  };
}

const BADGE_TINTED_RULES: Record<string, DerivationRule> = {
  ...badgeTintedRoleRules("accent", "accent"),
  ...badgeTintedRoleRules("action", "action"),
  ...badgeTintedRoleRules("agent", "agent"),
  ...badgeTintedRoleRules("data", "data"),
  ...badgeTintedRoleRules("danger", "destructive"),
  ...badgeTintedRoleRules("success", "success"),
  ...badgeTintedRoleRules("caution", "caution"),
};

// ---------------------------------------------------------------------------
// F2. Badge Outlined — factory helper
// 7 roles × 4 properties (surface, text, border, icon) = 28 tokens
// Badges are non-interactive: rest state only (no hover/active).
// Text/icon: role-colored via roleIntensity + semanticRoleTone (semanticTone builder).
// Border: role-colored via borderRest (roleIntensity+5, borderRoleTone).
// Surface: transparent.
// ---------------------------------------------------------------------------

/**
 * Build 4 badge-outlined tokens for a role (rest only).
 * Surface: transparent
 * Text: role hue at roleIntensity, semanticRoleTone
 * Border: role hue at roleIntensity+5, borderRoleTone
 * Icon: role hue at roleIntensity, semanticRoleTone (same as text)
 */
function outlinedBadgeRules(role: string, hueSlot: string): Record<string, DerivationRule> {
  return {
    [`--tug-surface-badge-primary-outlined-${role}-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`--tug-element-badge-text-outlined-${role}-rest`]: semanticTone()(hueSlot),
    [`--tug-element-badge-border-outlined-${role}-rest`]: borderRest(hueSlot),
    [`--tug-element-badge-icon-outlined-${role}-rest`]: semanticTone()(hueSlot),
  };
}

const BADGE_OUTLINED_RULES: Record<string, DerivationRule> = {
  ...outlinedBadgeRules("accent", "accent"),
  ...outlinedBadgeRules("action", "action"),
  ...outlinedBadgeRules("danger", "destructive"),
  ...outlinedBadgeRules("agent", "agent"),
  ...outlinedBadgeRules("data", "data"),
  ...outlinedBadgeRules("success", "success"),
  ...outlinedBadgeRules("caution", "caution"),
};

// ---------------------------------------------------------------------------
// F3. Badge Ghost — factory helper
// 7 roles × 4 properties (surface, text, border, icon) = 28 tokens
// Badges are non-interactive: rest state only (no hover/active).
// Text/icon: role-colored via roleIntensity + semanticRoleTone (semanticTone builder).
// Border: transparent at rest.
// Surface: transparent.
// ---------------------------------------------------------------------------

/**
 * Build 4 badge-ghost tokens for a role (rest only).
 * Surface: transparent
 * Text: role hue at roleIntensity, semanticRoleTone
 * Border: transparent
 * Icon: role hue at roleIntensity, semanticRoleTone (same as text)
 */
function ghostBadgeRules(role: string, hueSlot: string): Record<string, DerivationRule> {
  return {
    [`--tug-surface-badge-primary-ghost-${role}-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`--tug-element-badge-text-ghost-${role}-rest`]: semanticTone()(hueSlot),
    [`--tug-element-badge-border-ghost-${role}-rest`]: { type: "structural", valueExpr: () => "transparent" },
    [`--tug-element-badge-icon-ghost-${role}-rest`]: semanticTone()(hueSlot),
  };
}

const BADGE_GHOST_RULES: Record<string, DerivationRule> = {
  ...ghostBadgeRules("accent", "accent"),
  ...ghostBadgeRules("action", "action"),
  ...ghostBadgeRules("danger", "destructive"),
  ...ghostBadgeRules("agent", "agent"),
  ...ghostBadgeRules("data", "data"),
  ...ghostBadgeRules("success", "success"),
  ...ghostBadgeRules("caution", "caution"),
};

// ---------------------------------------------------------------------------
// RULES — complete merged rule table for all 373 tokens
// ---------------------------------------------------------------------------

/**
 * Complete derivation rule table for all 373 --tug-* tokens.
 *
 * Sections A-F combined. In Step 7, evaluateRules(RULES, ...) replaces
 * the entire imperative deriveTheme() body.
 */
export const RULES: Record<string, DerivationRule> = {
  ...SURFACE_RULES,
  ...FOREGROUND_RULES,
  ...CARD_TITLE_RULES,
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
  ...BADGE_OUTLINED_RULES,
  ...BADGE_GHOST_RULES,
};
