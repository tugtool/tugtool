/**
 * Theme Derivation Engine — Tugways Theme Generator
 *
 * Derives complete 373-token `--tug-base-*` themes from a compact `ThemeRecipe`.
 * Each call to `deriveTheme()` returns:
 *   - `tokens`: all 373 token values as `--tug-color()` strings (for CSS export)
 *   - `resolved`: OKLCH values for all chromatic tokens (for contrast checking / CVD)
 *
 * The derivation uses a three-layer declarative pipeline:
 *   Layer 1 — resolveHueSlots(): recipe + warmth knob → ResolvedHueSlots
 *             Applies warmth bias to every hue in the recipe and resolves all
 *             per-tier hue variants (fg-muted, surfBareBase, etc.).
 *   Layer 2 — computeTones(): DerivationFormulas + MoodKnobs → ComputedTones
 *             Pre-computes all derived tone values from mood knobs and formula constants.
 *   Layer 3 — evaluateRules(): RULES table → tokens + resolved maps
 *             Iterates the declarative rule table in derivation-rules.ts, calling
 *             the appropriate helper for each token type.
 *
 * Mood knobs (`surfaceContrast`, `signalIntensity`, `warmth`) modulate tone
 * spreads, intensity levels, and hue angles. Mode differences (dark vs light)
 * are expressed entirely as data in DARK_FORMULAS (and future recipe formulas)
 * and the RULES table — deriveTheme() itself contains no mode branching.
 *
 * Control tokens use the emphasis x role system (Table T01):
 *   13 combinations × 4 properties × 3 states = 156 emphasis-role control tokens
 *   (11 original combinations + 2 new: outlined-option, ghost-option)
 *   Plus 1 surface-control alias = 157 control tokens total
 *
 * [D01] Export format — tokens map matches tug-base.css override structure
 * [D02] Emphasis x role token naming: --tug-base-control-{emphasis}-{role}-{property}-{state}
 * [D04] ThemeRecipe interface from proposal
 * [D06] HueSlot resolution — Layer 1 of the pipeline
 * [D07] __white/__highlight/__shadow/__verboseHighlight sentinels
 * [D08] Scope: --tug-base-* tokens only
 * [D09] Dual output: string tokens + resolved OKLCH map
 *
 * ---------------------------------------------------------------------------
 * Semantic Decision Groups
 * ---------------------------------------------------------------------------
 *
 * A theme recipe is a set of positions on ~23 semantic decisions. Each field
 * in `DerivationFormulas` is tagged with `@semantic <group>` to link it to
 * its decision group. A recipe author — human or LLM — can locate all the
 * parameters for a given design intent by searching for `@semantic <group>`.
 *
 * Group                    What it controls
 * ----------------------   -------------------------------------------------------
 * canvas-darkness          How dark/light the app background is.
 *                          Fields: bgAppTone, bgCanvasTone
 *
 * surface-layering         How surfaces stack visually above the canvas. The tone
 *                          values set the absolute lightness of each surface tier
 *                          at surfaceContrast=50.
 *                          Fields: surfaceSunkenTone, surfaceDefaultTone,
 *                                  surfaceRaisedTone, surfaceOverlayTone,
 *                                  surfaceInsetTone, surfaceContentTone,
 *                                  surfaceScreenTone
 *
 * surface-coloring         How much chroma surfaces carry. Controls the intensity
 *                          (saturation) applied to atmosphere and canvas hues for
 *                          every surface tier.
 *                          Fields: atmI, bgAppI, bgCanvasI, surfaceDefaultI,
 *                                  surfaceRaisedI, surfaceOverlayI, surfaceScreenI,
 *                                  surfaceInsetI, surfaceContentI, bgAppSurfaceI
 *
 * text-brightness          How bright primary and inverse text is.
 *                          Fields: fgDefaultTone, fgInverseTone
 *
 * text-hierarchy           How much secondary/tertiary text dims from primary. The
 *                          tone spread across muted, subtle, disabled, and
 *                          placeholder tiers.
 *                          Fields: fgMutedTone, fgSubtleTone, fgDisabledTone,
 *                                  fgPlaceholderTone
 *
 * text-coloring            How much chroma text carries. Controls saturation for
 *                          primary, subtle, muted, inverse, and on-surface text.
 *                          Fields: txtI, txtISubtle, fgMutedI, atmIBorder,
 *                                  fgInverseI, fgOnCautionI, fgOnSuccessI
 *
 * border-visibility        How visible borders and dividers are. Controls tone and
 *                          intensity for default, muted, strong borders and dividers.
 *                          Fields: borderIBase, borderIStrong, borderMutedTone,
 *                                  borderMutedI, borderStrongTone, dividerDefaultI,
 *                                  dividerMutedI
 *
 * card-frame-style         How card title bars and tab bars present. Controls the
 *                          tone and intensity of active and inactive card frames.
 *                          Fields: cardFrameActiveI, cardFrameActiveTone,
 *                                  cardFrameInactiveI, cardFrameInactiveTone
 *
 * shadow-depth             How pronounced shadows and overlay tints are. Controls
 *                          alpha values for all shadow sizes and overlay layers.
 *                          Fields: shadowXsAlpha, shadowMdAlpha, shadowLgAlpha,
 *                                  shadowXlAlpha, shadowOverlayAlpha, overlayDimAlpha,
 *                                  overlayScrimAlpha, overlayHighlightAlpha
 *
 * filled-control-prominence How bold filled buttons are. Controls the tone of the
 *                          filled button background at rest, hover, and press.
 *                          Fields: filledBgDarkTone, filledBgHoverTone,
 *                                  filledBgActiveTone
 *
 * outlined-control-style   How outlined buttons present across states and modes.
 *                          Controls fg/icon tone and intensity, option border tones,
 *                          hover/active background intensity and alpha.
 *                          Fields: outlinedFgRestTone, outlinedFgHoverTone,
 *                                  outlinedFgActiveTone, outlinedFgI,
 *                                  outlinedIconRestTone, outlinedIconHoverTone,
 *                                  outlinedIconActiveTone, outlinedIconI,
 *                                  outlinedFgRestToneLight, outlinedFgHoverToneLight,
 *                                  outlinedFgActiveToneLight,
 *                                  outlinedIconRestToneLight,
 *                                  outlinedIconHoverToneLight,
 *                                  outlinedIconActiveToneLight,
 *                                  outlinedOptionBorderRestTone,
 *                                  outlinedOptionBorderHoverTone,
 *                                  outlinedOptionBorderActiveTone,
 *                                  outlinedBgHoverI, outlinedBgHoverAlphaValue,
 *                                  outlinedBgActiveI, outlinedBgActiveAlphaValue
 *
 * ghost-control-style      How ghost buttons present across states and modes.
 *                          Controls fg/icon/border tone and intensity for action
 *                          and option roles.
 *                          Fields: ghostFgRestTone, ghostFgHoverTone,
 *                                  ghostFgActiveTone, ghostFgRestI, ghostFgHoverI,
 *                                  ghostFgActiveI, ghostIconRestTone,
 *                                  ghostIconHoverTone, ghostIconActiveTone,
 *                                  ghostIconRestI, ghostIconHoverI, ghostIconActiveI,
 *                                  ghostBorderI, ghostBorderTone,
 *                                  ghostFgRestToneLight, ghostFgHoverToneLight,
 *                                  ghostFgActiveToneLight, ghostFgRestILight,
 *                                  ghostFgHoverILight, ghostFgActiveILight,
 *                                  ghostIconRestToneLight, ghostIconHoverToneLight,
 *                                  ghostIconActiveToneLight, ghostIconActiveILight
 *
 * badge-style              How tinted badges present. Controls fg/bg/border tone,
 *                          intensity, and alpha for the tinted badge variant.
 *                          Fields: badgeTintedFgI, badgeTintedFgTone,
 *                                  badgeTintedBgI, badgeTintedBgTone,
 *                                  badgeTintedBgAlpha, badgeTintedBorderI,
 *                                  badgeTintedBorderTone, badgeTintedBorderAlpha
 *
 * icon-style               How icons present in non-control contexts. Controls
 *                          tone and intensity for active and muted icon tiers.
 *                          Fields: iconActiveTone, iconMutedI, iconMutedTone
 *
 * tab-style                How tabs present. Controls the active tab foreground
 *                          tone.
 *                          Fields: tabFgActiveTone
 *
 * toggle-style             How toggles present. Controls hover/disabled tones and
 *                          intensity for the toggle track and thumb.
 *                          Fields: toggleTrackOnHoverTone, toggleThumbDisabledTone,
 *                                  toggleTrackDisabledI
 *
 * field-style              How form fields present. Controls tone anchors and
 *                          intensity for field backgrounds and borders across all
 *                          states, plus disabled control parameters.
 *                          Fields: fieldBgRestTone, fieldBgHoverTone,
 *                                  fieldBgFocusTone, fieldBgDisabledTone,
 *                                  fieldBgReadOnlyTone, fieldBgRestI,
 *                                  disabledBgI, disabledBorderI
 *
 * hue-slot-dispatch        Which hue slot each surface, foreground, icon, border,
 *                          disabled, field, and toggle tier reads from. These are
 *                          string keys into ResolvedHueSlots that determine what
 *                          hue family each token uses.
 *                          Fields: bgAppHueSlot, bgCanvasHueSlot,
 *                                  surfaceSunkenHueSlot, surfaceDefaultHueSlot,
 *                                  surfaceRaisedHueSlot, surfaceOverlayHueSlot,
 *                                  surfaceInsetHueSlot, surfaceContentHueSlot,
 *                                  surfaceScreenHueSlot, fgMutedHueSlot,
 *                                  fgSubtleHueSlot, fgDisabledHueSlot,
 *                                  fgPlaceholderHueSlot, fgInverseHueSlot,
 *                                  fgOnAccentHueSlot, iconMutedHueSlot,
 *                                  iconOnAccentHueSlot, dividerMutedHueSlot,
 *                                  disabledBgHueSlot, fieldBgHoverHueSlot,
 *                                  fieldBgReadOnlyHueSlot, fieldPlaceholderHueSlot,
 *                                  fieldBorderRestHueSlot, fieldBorderHoverHueSlot,
 *                                  toggleTrackDisabledHueSlot, toggleThumbHueSlot,
 *                                  checkmarkHueSlot, radioDotHueSlot,
 *                                  tabBgActiveHueSlot, tabBgInactiveHueSlot
 *
 * sentinel-hue-dispatch    Which sentinel hue slot hover/active interactive
 *                          backgrounds use (__highlight, __verboseHighlight, etc.).
 *                          Fields: outlinedBgHoverHueSlot, outlinedBgActiveHueSlot,
 *                                  ghostActionBgHoverHueSlot,
 *                                  ghostActionBgActiveHueSlot,
 *                                  ghostOptionBgHoverHueSlot,
 *                                  ghostOptionBgActiveHueSlot,
 *                                  tabBgHoverHueSlot, tabCloseBgHoverHueSlot,
 *                                  highlightHoverHueSlot
 *
 * sentinel-alpha           Alpha values for sentinel-dispatched hover/active
 *                          interactive tokens. Determines how opaque the tinted
 *                          hover/press overlay appears.
 *                          Fields: tabBgHoverAlpha, tabCloseBgHoverAlpha,
 *                                  outlinedBgHoverAlpha, outlinedBgActiveAlpha,
 *                                  ghostActionBgHoverAlpha,
 *                                  ghostActionBgActiveAlpha,
 *                                  ghostOptionBgHoverAlpha,
 *                                  ghostOptionBgActiveAlpha, highlightHoverAlpha,
 *                                  ghostDangerBgHoverAlpha, ghostDangerBgActiveAlpha
 *
 * computed-tone-override   Flat-value overrides for tones that otherwise derive
 *                          from formulas, plus formula parameters for canvas and
 *                          disabled-bg tone computations.
 *                          Fields: dividerDefaultToneOverride,
 *                                  dividerMutedToneOverride, disabledFgToneValue,
 *                                  disabledBorderToneOverride,
 *                                  outlinedBgRestToneOverride,
 *                                  outlinedBgHoverToneOverride,
 *                                  outlinedBgActiveToneOverride,
 *                                  toggleTrackOffToneOverride,
 *                                  toggleDisabledToneOverride,
 *                                  bgCanvasToneBase, bgCanvasToneSCCenter,
 *                                  bgCanvasToneScale, disabledBgBase,
 *                                  disabledBgScale, borderStrongToneValue
 *
 * hue-name-dispatch        Named hue values used in resolveHueSlots() to eliminate
 *                          runtime mode branches. These string fields directly name
 *                          the hue family for derived slots (surfScreen, fgMuted,
 *                          fgSubtle, etc.).
 *                          Fields: surfScreenHue, fgMutedHueExpr, fgSubtleHue,
 *                                  fgDisabledHue, fgInverseHue, fgPlaceholderSource,
 *                                  selectionInactiveHue
 *
 * selection-mode           Selection behavior mode flags and parameters. Controls
 *                          how the inactive selection background is resolved and
 *                          how prominent it appears.
 *                          Fields: selectionInactiveSemanticMode,
 *                                  selectionBgInactiveI, selectionBgInactiveTone,
 *                                  selectionBgInactiveAlpha
 *
 * @module components/tugways/theme-derivation-engine
 */

import {
  HUE_FAMILIES,
  DEFAULT_CANONICAL_L,
  MAX_CHROMA_FOR_HUE,
  PEAK_C_SCALE,
  L_DARK,
  L_LIGHT,
  isInSRGBGamut,
  ADJACENCY_RING,
  resolveHyphenatedHue,
} from "./palette-engine";
import { RULES } from "./derivation-rules";
import {
  toneToL,
  CONTRAST_SCALE,
  POLARITY_FACTOR,
  CONTRAST_MIN_DELTA,
  CONTRAST_THRESHOLDS,
} from "./theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "./element-surface-pairing-map";
import type { ElementSurfacePairing } from "./element-surface-pairing-map";

// ---------------------------------------------------------------------------
// Public interfaces — Spec S01 / S02
// ---------------------------------------------------------------------------

/**
 * Compact recipe input. Minimum 3 values (mode + cardBg + text);
 * full control with ~16. Spec S01.
 */
export interface ThemeRecipe {
  name: string;
  /** Human-readable description of the design intent for this theme. */
  description: string;
  mode: "dark" | "light";
  cardBg: { hue: string };
  text: { hue: string };
  accent?: string;
  active?: string;
  link?: string;      // hue for fg-link, fg-link-hover, selection highlight; [D05]
  destructive?: string;
  success?: string;
  caution?: string;
  agent?: string;
  data?: string;
  canvas?: string;    // hue for bg-canvas, bg-app (default: same as cardBg hue)
  cardFrame?: string; // hue for card title bar, tab bar bg (default: "indigo")
  borderTint?: string; // hue for border-default/muted/strong, dividers (default: same as cardBg hue)
  surfaceContrast?: number; // 0-100, default 50
  signalIntensity?: number; // 0-100, default 50
  warmth?: number; // 0-100, default 50
  /** All formula constants for this recipe. Falls back to DARK_FORMULAS when absent. [D02] */
  formulas?: DerivationFormulas;
}

/**
 * Resolved OKLCH value for a single token. Spec S02.
 */
export interface ResolvedColor {
  L: number;
  C: number;
  h: number;
  alpha: number; // 0-1
}

/**
 * Contrast result for an element/surface pair. Spec S02.
 * Populated by the accessibility module.
 *
 * Normative gate: `contrastPass` (perceptual contrast threshold per role).
 * Informational: `wcagRatio` retained for display in the contrast dashboard.
 */
export interface ContrastResult {
  fg: string;
  bg: string;
  wcagRatio: number;
  contrast: number;
  contrastPass: boolean;
  role: "body-text" | "subdued-text" | "large-text" | "ui-component" | "decorative";
}

/**
 * CVD warning for a token pair. Spec S02.
 * Populated by the CVD simulation module (Step 5).
 */
export interface CVDWarning {
  type: "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";
  tokenPair: [string, string];
  description: string;
  suggestion: string;
}

/**
 * Structured diagnostic entry for a token whose tone was adjusted during
 * contrast floor enforcement in evaluateRules(). Spec S04.
 *
 * Reasons:
 *   "floor-applied"         — tone was clamped by enforceContrastFloor to meet threshold
 *   "structurally-fixed"    — token is black/white/transparent/alpha; not adjustable
 *   "composite-dependent"   — token uses parentSurface compositing; floor not applied
 */
export interface ContrastDiagnostic {
  token: string;
  reason: "floor-applied" | "structurally-fixed" | "composite-dependent";
  surfaces: string[];
  initialTone: number;
  finalTone: number;
  threshold: number;
}

/**
 * Output from deriveTheme(). Spec S02.
 * contrastResults and cvdWarnings are populated in later steps.
 * diagnostics is populated by enforceContrastFloor in evaluateRules.
 */
export interface ThemeOutput {
  name: string;
  mode: "dark" | "light";
  tokens: Record<string, string>;
  resolved: Record<string, ResolvedColor>;
  contrastResults: ContrastResult[];
  cvdWarnings: CVDWarning[];
  diagnostics: ContrastDiagnostic[];
}

// ---------------------------------------------------------------------------
// ResolvedHueSlot / ResolvedHueSlots — Layer 1 output (Spec S02)
// ---------------------------------------------------------------------------

/**
 * A single resolved hue slot with warmth bias applied.
 * Produced by resolveHueSlots(). Spec S02.
 */
export interface ResolvedHueSlot {
  /** Hue angle in degrees, warmth-biased. */
  angle: number;
  /** Closest hue family name (e.g., "violet", "indigo-cobalt"). */
  name: string;
  /** Formatted hue ref for --tug-color() (e.g., "violet", "indigo-cobalt"). */
  ref: string;
  /** Primary color name for canonical-L / max-chroma lookup (e.g., "violet"). */
  primaryName: string;
}

/**
 * Complete set of resolved hue slots for a recipe.
 * Produced by resolveHueSlots(); consumed by the rule evaluator. Spec S02.
 *
 * Slots are grouped into:
 *   - Recipe hues (atm, txt, canvas, cardFrame, borderTint, interactive, active, accent)
 *   - Semantic hues (destructive, success, caution, agent, data) — no warmth bias
 *   - Per-tier derived hues (surfBareBase, surfScreen, fgMuted, fgSubtle, fgDisabled,
 *     fgInverse, fgPlaceholder, selectionInactive, borderTintBareBase, borderStrong)
 */
export interface ResolvedHueSlots {
  // Recipe hues (warmth bias applied to achromatic-adjacent hues)
  atm: ResolvedHueSlot;         // atmosphere (cardBg hue)
  txt: ResolvedHueSlot;         // text hue
  canvas: ResolvedHueSlot;      // canvas hue (bg-app, bg-canvas)
  cardFrame: ResolvedHueSlot;   // card title bar hue
  borderTint: ResolvedHueSlot;  // border/divider tint hue
  interactive: ResolvedHueSlot; // link/selection hue [D05]
  active: ResolvedHueSlot;      // active state hue
  accent: ResolvedHueSlot;      // accent hue
  // Semantic hues (no warmth bias — vivid signal hues)
  destructive: ResolvedHueSlot;
  success: ResolvedHueSlot;
  caution: ResolvedHueSlot;
  agent: ResolvedHueSlot;
  data: ResolvedHueSlot;
  // Per-tier derived hues
  surfBareBase: ResolvedHueSlot;      // bare base of atm hue (last segment of hyphenated name)
  surfScreen: ResolvedHueSlot;        // screen surface hue (dark: "indigo"; light: txt)
  fgMuted: ResolvedHueSlot;           // fg-muted tier hue (dark: bare primary of txt; light: txt)
  fgSubtle: ResolvedHueSlot;          // fg-subtle tier hue (dark: "indigo-cobalt"; light: txt)
  fgDisabled: ResolvedHueSlot;        // fg-disabled tier hue (dark: "indigo-cobalt"; light: txt)
  fgInverse: ResolvedHueSlot;         // fg-inverse tier hue (dark: "sapphire-cobalt"; light: txt)
  fgPlaceholder: ResolvedHueSlot;     // fg-placeholder tier hue (dark: same as fgMuted; light: atm)
  selectionInactive: ResolvedHueSlot; // selection-bg-inactive hue (dark: "yellow"; light: atmBaseAngle-20)
  borderTintBareBase: ResolvedHueSlot; // bare base of borderTint hue (same logic as surfBareBase)
  borderStrong: ResolvedHueSlot;       // borderTint shifted -5° for contrast distinction
}

// ---------------------------------------------------------------------------
// DerivationFormulas — self-contained recipe formula constants [D01]
// ---------------------------------------------------------------------------

/**
 * All formula constants for a theme recipe. The canonical parameter bundle —
 * a recipe IS its formulas; dark and light are different recipes, not
 * parameterizations of one recipe. [D01]
 *
 * Lives on `ThemeRecipe.formulas` (optional; `deriveTheme()` falls back to
 * `DARK_FORMULAS` when absent). [D02]
 *
 * Fields are grouped by the 23 semantic decision groups (see module JSDoc
 * table). Each group is introduced with a banner comment. Search for
 * `@semantic <group>` to locate all parameters for a given design intent.
 *
 * Spec S01.
 */
export interface DerivationFormulas {
  // ===== Canvas Darkness =====
  // How dark/light the app background is. Dark: tones 5-10. Light: tones 90-95.
  /** @semantic canvas-darkness — tone of the app background surface */
  bgAppTone: number;
  /** @semantic canvas-darkness — tone of the canvas (page-level) background */
  bgCanvasTone: number;

  // ===== Surface Layering =====
  // How surfaces stack visually above the canvas. Dark: ascending from ~6. Light: descending from ~95.
  /** @semantic surface-layering — tone of sunken surfaces (inset wells, recessed areas) */
  surfaceSunkenTone: number;
  /** @semantic surface-layering — tone of the default card/panel surface */
  surfaceDefaultTone: number;
  /** @semantic surface-layering — tone of raised surfaces (popovers, dropdowns) */
  surfaceRaisedTone: number;
  /** @semantic surface-layering — tone of overlay surfaces (modals, sheets) */
  surfaceOverlayTone: number;
  /** @semantic surface-layering — tone of inset surfaces (nested content areas) */
  surfaceInsetTone: number;
  /** @semantic surface-layering — tone of content surfaces (text-area-like regions) */
  surfaceContentTone: number;
  /** @semantic surface-layering — tone of screen surfaces (full-bleed backgrounds behind cards) */
  surfaceScreenTone: number;

  // ===== Surface Coloring =====
  // How much chroma surfaces carry. Dark: I 2-7. Light: I 3-8.
  /** @semantic surface-coloring — base chroma intensity for atmosphere-hued surfaces */
  atmI: number;
  /** @semantic surface-coloring — chroma intensity for the app background surface */
  bgAppI: number;
  /** @semantic surface-coloring — chroma intensity for the canvas background */
  bgCanvasI: number;
  /** @semantic surface-coloring — chroma intensity for the default card surface */
  surfaceDefaultI: number;
  /** @semantic surface-coloring — chroma intensity for raised surfaces */
  surfaceRaisedI: number;
  /** @semantic surface-coloring — chroma intensity for overlay surfaces */
  surfaceOverlayI: number;
  /** @semantic surface-coloring — chroma intensity for screen surfaces */
  surfaceScreenI: number;
  /** @semantic surface-coloring — chroma intensity for inset surfaces */
  surfaceInsetI: number;
  /** @semantic surface-coloring — chroma intensity for content surfaces */
  surfaceContentI: number;
  /**
   * @semantic surface-coloring — bg-app intensity unified field.
   * Dark: bgAppI (2). Light: atmI.
   */
  bgAppSurfaceI: number;

  // ===== Text Brightness =====
  // How bright primary and inverse text is. Dark: near 100. Light: near 0.
  /** @semantic text-brightness — tone of primary body text */
  fgDefaultTone: number;
  /** @semantic text-brightness — tone of inverse (on-filled) text */
  fgInverseTone: number;

  // ===== Text Hierarchy =====
  // How much secondary/tertiary text dims from primary. Dark: descending from 94. Light: ascending from 8.
  /** @semantic text-hierarchy — tone of muted (secondary) text */
  fgMutedTone: number;
  /** @semantic text-hierarchy — tone of subtle (tertiary) text */
  fgSubtleTone: number;
  /** @semantic text-hierarchy — tone of disabled text */
  fgDisabledTone: number;
  /** @semantic text-hierarchy — tone of placeholder text */
  fgPlaceholderTone: number;

  // ===== Text Coloring =====
  // How much chroma text carries. Dark: I 2-7. Light: I 3-8.
  /** @semantic text-coloring — chroma intensity for primary text */
  txtI: number;
  /** @semantic text-coloring — chroma intensity for subtle text tiers */
  txtISubtle: number;
  /** @semantic text-coloring — chroma intensity for muted text */
  fgMutedI: number;
  /** @semantic text-coloring — chroma intensity for atmosphere-hued border tiers */
  atmIBorder: number;
  /** @semantic text-coloring — chroma intensity for inverse (on-filled) text */
  fgInverseI: number;
  /** @semantic text-coloring — chroma intensity for text on caution surfaces */
  fgOnCautionI: number;
  /** @semantic text-coloring — chroma intensity for text on success surfaces */
  fgOnSuccessI: number;

  // ===== Border Visibility =====
  // How visible borders and dividers are. Dark: subtle I 4-7. Light: crisp I 6-10.
  /** @semantic border-visibility — base chroma intensity for default borders */
  borderIBase: number;
  /** @semantic border-visibility — chroma intensity for strong/emphasis borders */
  borderIStrong: number;
  /** @semantic border-visibility — tone of muted (de-emphasized) borders */
  borderMutedTone: number;
  /** @semantic border-visibility — chroma intensity for muted borders */
  borderMutedI: number;
  /** @semantic border-visibility — tone of strong (high-contrast) borders */
  borderStrongTone: number;
  /** @semantic border-visibility — chroma intensity for default divider lines */
  dividerDefaultI: number;
  /** @semantic border-visibility — chroma intensity for muted divider lines */
  dividerMutedI: number;

  // ===== Card Frame Style =====
  // How card title bars and tab bars present. Dark: dim tones 15-18. Light: bright tones 85-92.
  /** @semantic card-frame-style — chroma intensity for the active card title bar */
  cardFrameActiveI: number;
  /** @semantic card-frame-style — tone of the active card title bar */
  cardFrameActiveTone: number;
  /** @semantic card-frame-style — chroma intensity for inactive card title bars */
  cardFrameInactiveI: number;
  /** @semantic card-frame-style — tone of inactive card title bars */
  cardFrameInactiveTone: number;

  // ===== Shadow Depth =====
  // How pronounced shadows and overlay tints are. Dark: 20-80% alpha. Light: 10-40% alpha.
  /** @semantic shadow-depth — alpha for extra-small drop shadows */
  shadowXsAlpha: number;
  /** @semantic shadow-depth — alpha for medium drop shadows */
  shadowMdAlpha: number;
  /** @semantic shadow-depth — alpha for large drop shadows */
  shadowLgAlpha: number;
  /** @semantic shadow-depth — alpha for extra-large drop shadows */
  shadowXlAlpha: number;
  /** @semantic shadow-depth — alpha for overlay drop shadows (floating panels) */
  shadowOverlayAlpha: number;
  /** @semantic shadow-depth — alpha for dim overlay backgrounds */
  overlayDimAlpha: number;
  /** @semantic shadow-depth — alpha for scrim backgrounds (modal blocking layer) */
  overlayScrimAlpha: number;
  /** @semantic shadow-depth — alpha for highlight overlay tints */
  overlayHighlightAlpha: number;

  // ===== Filled Control Prominence =====
  // How bold filled buttons are. Dark: mid-tone bg. Light: same (filled stays vivid).
  /** @semantic filled-control-prominence — tone of the dark (resting) filled button background */
  filledBgDarkTone: number;
  /** @semantic filled-control-prominence — tone of the filled button background on hover */
  filledBgHoverTone: number;
  /** @semantic filled-control-prominence — tone of the filled button background on press */
  filledBgActiveTone: number;

  // ===== Outlined Control Style =====
  // How outlined buttons present across states/modes. Dark: white fg. Light: dark fg.
  /** @semantic outlined-control-style — tone of outlined button foreground text at rest */
  outlinedFgRestTone: number;
  /** @semantic outlined-control-style — tone of outlined button foreground text on hover */
  outlinedFgHoverTone: number;
  /** @semantic outlined-control-style — tone of outlined button foreground text on press */
  outlinedFgActiveTone: number;
  /** @semantic outlined-control-style — chroma intensity for outlined button foreground text */
  outlinedFgI: number;
  /** @semantic outlined-control-style — tone of outlined button icons at rest */
  outlinedIconRestTone: number;
  /** @semantic outlined-control-style — tone of outlined button icons on hover */
  outlinedIconHoverTone: number;
  /** @semantic outlined-control-style — tone of outlined button icons on press */
  outlinedIconActiveTone: number;
  /** @semantic outlined-control-style — chroma intensity for outlined button icons */
  outlinedIconI: number;
  /** @semantic outlined-control-style — light-mode tone of outlined button foreground text at rest */
  outlinedFgRestToneLight: number;
  /** @semantic outlined-control-style — light-mode tone of outlined button foreground text on hover */
  outlinedFgHoverToneLight: number;
  /** @semantic outlined-control-style — light-mode tone of outlined button foreground text on press */
  outlinedFgActiveToneLight: number;
  /** @semantic outlined-control-style — light-mode tone of outlined button icons at rest */
  outlinedIconRestToneLight: number;
  /** @semantic outlined-control-style — light-mode tone of outlined button icons on hover */
  outlinedIconHoverToneLight: number;
  /** @semantic outlined-control-style — light-mode tone of outlined button icons on press */
  outlinedIconActiveToneLight: number;
  /** @semantic outlined-control-style — tone of outlined option border at rest */
  outlinedOptionBorderRestTone: number;
  /** @semantic outlined-control-style — tone of outlined option border on hover */
  outlinedOptionBorderHoverTone: number;
  /** @semantic outlined-control-style — tone of outlined option border on press */
  outlinedOptionBorderActiveTone: number;
  /**
   * @semantic outlined-control-style — outlined bg-hover intensity unified field.
   * Dark: 0 (highlight sentinel). Light: 4.
   */
  outlinedBgHoverI: number;
  /**
   * @semantic outlined-control-style — outlined bg-hover alpha unified field.
   * Dark: outlinedBgHoverAlpha (10). Light: 100.
   */
  outlinedBgHoverAlphaValue: number;
  /**
   * @semantic outlined-control-style — outlined bg-active intensity unified field.
   * Dark: 0 (highlight sentinel). Light: 6.
   */
  outlinedBgActiveI: number;
  /**
   * @semantic outlined-control-style — outlined bg-active alpha unified field.
   * Dark: outlinedBgActiveAlpha (20). Light: 100.
   */
  outlinedBgActiveAlphaValue: number;

  // ===== Ghost Control Style =====
  // How ghost buttons present across states/modes. Dark: white fg. Light: dark fg.
  /** @semantic ghost-control-style — tone of ghost button foreground text at rest */
  ghostFgRestTone: number;
  /** @semantic ghost-control-style — tone of ghost button foreground text on hover */
  ghostFgHoverTone: number;
  /** @semantic ghost-control-style — tone of ghost button foreground text on press */
  ghostFgActiveTone: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button foreground text at rest */
  ghostFgRestI: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button foreground text on hover */
  ghostFgHoverI: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button foreground text on press */
  ghostFgActiveI: number;
  /** @semantic ghost-control-style — tone of ghost button icons at rest */
  ghostIconRestTone: number;
  /** @semantic ghost-control-style — tone of ghost button icons on hover */
  ghostIconHoverTone: number;
  /** @semantic ghost-control-style — tone of ghost button icons on press */
  ghostIconActiveTone: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button icons at rest */
  ghostIconRestI: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button icons on hover */
  ghostIconHoverI: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button icons on press */
  ghostIconActiveI: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button borders */
  ghostBorderI: number;
  /** @semantic ghost-control-style — tone of ghost button borders */
  ghostBorderTone: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button foreground text at rest */
  ghostFgRestToneLight: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button foreground text on hover */
  ghostFgHoverToneLight: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button foreground text on press */
  ghostFgActiveToneLight: number;
  /** @semantic ghost-control-style — light-mode chroma intensity for ghost button foreground text at rest */
  ghostFgRestILight: number;
  /** @semantic ghost-control-style — light-mode chroma intensity for ghost button foreground text on hover */
  ghostFgHoverILight: number;
  /** @semantic ghost-control-style — light-mode chroma intensity for ghost button foreground text on press */
  ghostFgActiveILight: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button icons at rest */
  ghostIconRestToneLight: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button icons on hover */
  ghostIconHoverToneLight: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button icons on press */
  ghostIconActiveToneLight: number;
  /** @semantic ghost-control-style — light-mode chroma intensity for ghost button icons on press */
  ghostIconActiveILight: number;

  // ===== Badge Style =====
  // How tinted badges present. Dark: bright fg on tinted bg. Light: dark fg on tinted bg.
  /** @semantic badge-style — chroma intensity for tinted badge foreground text */
  badgeTintedFgI: number;
  /** @semantic badge-style — tone of tinted badge foreground text */
  badgeTintedFgTone: number;
  /** @semantic badge-style — chroma intensity for tinted badge background */
  badgeTintedBgI: number;
  /** @semantic badge-style — tone of tinted badge background */
  badgeTintedBgTone: number;
  /** @semantic badge-style — alpha of tinted badge background */
  badgeTintedBgAlpha: number;
  /** @semantic badge-style — chroma intensity for tinted badge border */
  badgeTintedBorderI: number;
  /** @semantic badge-style — tone of tinted badge border */
  badgeTintedBorderTone: number;
  /** @semantic badge-style — alpha of tinted badge border */
  badgeTintedBorderAlpha: number;

  // ===== Icon Style =====
  // How icons present in non-control contexts. Dark: bright tones. Light: dark tones.
  /** @semantic icon-style — tone of active/interactive icons */
  iconActiveTone: number;
  /** @semantic icon-style — chroma intensity for muted icons */
  iconMutedI: number;
  /** @semantic icon-style — tone of muted icons */
  iconMutedTone: number;

  // ===== Tab Style =====
  // How tabs present. Dark: bright active fg. Light: dark active fg.
  /** @semantic tab-style — tone of foreground text/icons on the active tab */
  tabFgActiveTone: number;

  // ===== Toggle Style =====
  // How toggles present. Dark: bright thumb. Light: dark track.
  /** @semantic toggle-style — tone of the toggle track background on hover (on-state) */
  toggleTrackOnHoverTone: number;
  /** @semantic toggle-style — tone of the toggle thumb when disabled */
  toggleThumbDisabledTone: number;
  /** @semantic toggle-style — chroma intensity for the disabled toggle track */
  toggleTrackDisabledI: number;

  // ===== Field Style =====
  // How form fields present. Dark: dark bg tones. Light: light bg tones.
  /** @semantic field-style — tone of the field background at rest */
  fieldBgRestTone: number;
  /** @semantic field-style — tone of the field background on hover */
  fieldBgHoverTone: number;
  /** @semantic field-style — tone of the field background when focused */
  fieldBgFocusTone: number;
  /** @semantic field-style — tone of the field background when disabled */
  fieldBgDisabledTone: number;
  /** @semantic field-style — tone of the field background in read-only state */
  fieldBgReadOnlyTone: number;
  /** @semantic field-style — chroma intensity for the resting field background */
  fieldBgRestI: number;
  /** @semantic field-style — chroma intensity for disabled control backgrounds */
  disabledBgI: number;
  /** @semantic field-style — chroma intensity for disabled control borders */
  disabledBorderI: number;

  // ===== Hue Slot Dispatch =====
  // Which hue slot each surface/fg/icon/border tier reads from. String keys into ResolvedHueSlots.
  /** @semantic hue-slot-dispatch — hue slot for the app background surface */
  bgAppHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for the canvas background */
  bgCanvasHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for sunken surfaces */
  surfaceSunkenHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for the default card surface */
  surfaceDefaultHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for raised surfaces */
  surfaceRaisedHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for overlay surfaces */
  surfaceOverlayHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for inset surfaces */
  surfaceInsetHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for content surfaces */
  surfaceContentHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for screen surfaces */
  surfaceScreenHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for muted (secondary) foreground text */
  fgMutedHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for subtle (tertiary) foreground text */
  fgSubtleHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for disabled foreground text */
  fgDisabledHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for placeholder foreground text */
  fgPlaceholderHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for inverse (on-filled) foreground text */
  fgInverseHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for foreground text on accent-filled surfaces */
  fgOnAccentHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for muted icons */
  iconMutedHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for icons on accent-filled surfaces */
  iconOnAccentHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for muted divider lines */
  dividerMutedHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for disabled control backgrounds */
  disabledBgHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for the field background on hover */
  fieldBgHoverHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for read-only field backgrounds */
  fieldBgReadOnlyHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for field placeholder text */
  fieldPlaceholderHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for the field border at rest */
  fieldBorderRestHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for the field border on hover */
  fieldBorderHoverHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for the disabled toggle track */
  toggleTrackDisabledHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for the toggle thumb */
  toggleThumbHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for checkbox checkmarks */
  checkmarkHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for radio button dots */
  radioDotHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for the active tab bar background */
  tabBgActiveHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for inactive tab bar backgrounds */
  tabBgInactiveHueSlot: string;

  // ===== Sentinel Hue Dispatch =====
  // Which sentinel hue slot hover/active backgrounds use. String keys (__highlight, __verboseHighlight, etc.).
  /** @semantic sentinel-hue-dispatch — hue slot for outlined control hover background */
  outlinedBgHoverHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for outlined control active background */
  outlinedBgActiveHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for ghost action button hover background */
  ghostActionBgHoverHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for ghost action button active background */
  ghostActionBgActiveHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for ghost option button hover background */
  ghostOptionBgHoverHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for ghost option button active background */
  ghostOptionBgActiveHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for tab hover background */
  tabBgHoverHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for tab close button hover background */
  tabCloseBgHoverHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for inline highlight hover tint */
  highlightHoverHueSlot: string;

  // ===== Sentinel Alpha =====
  // Alpha values for sentinel-dispatched hover/active tokens. Percentage values 5-20.
  /** @semantic sentinel-alpha — alpha for tab background on hover */
  tabBgHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for tab close button background on hover */
  tabCloseBgHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for outlined control hover background */
  outlinedBgHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for outlined control active background */
  outlinedBgActiveAlpha: number;
  /** @semantic sentinel-alpha — alpha for ghost action button hover background */
  ghostActionBgHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for ghost action button active background */
  ghostActionBgActiveAlpha: number;
  /** @semantic sentinel-alpha — alpha for ghost option button hover background */
  ghostOptionBgHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for ghost option button active background */
  ghostOptionBgActiveAlpha: number;
  /** @semantic sentinel-alpha — alpha for inline highlight hover tint */
  highlightHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for ghost danger button hover background */
  ghostDangerBgHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for ghost danger button active background */
  ghostDangerBgActiveAlpha: number;

  // ===== Computed Tone Override =====
  // Flat-value overrides for computed tones and formula parameters. number or null.
  /**
   * @semantic computed-tone-override — flat tone for divider-default.
   * null = Math.round(surfaceOverlay - 2). Dark: 17.
   */
  dividerDefaultToneOverride: number | null;
  /**
   * @semantic computed-tone-override — flat tone for divider-muted.
   * null = Math.round(surfaceOverlay). Dark: 15.
   */
  dividerMutedToneOverride: number | null;
  /**
   * @semantic computed-tone-override — flat tone for disabled-fg.
   * Always a number (dark: 38; future light uses fgDisabledTone).
   */
  disabledFgToneValue: number;
  /**
   * @semantic computed-tone-override — flat tone for disabled-border.
   * null = Math.round(dividerTone). Dark: 28.
   */
  disabledBorderToneOverride: number | null;
  /**
   * @semantic computed-tone-override — flat tone for outlined-bg-rest.
   * null = Math.round(surfaceInset + 2). Dark: null (derives from formula).
   */
  outlinedBgRestToneOverride: number | null;
  /**
   * @semantic computed-tone-override — flat tone for outlined-bg-hover.
   * null = Math.round(surfaceRaised + 1). Dark: null (derives from formula).
   */
  outlinedBgHoverToneOverride: number | null;
  /**
   * @semantic computed-tone-override — flat tone for outlined-bg-active.
   * null = Math.round(surfaceOverlay). Dark: null (derives from formula).
   */
  outlinedBgActiveToneOverride: number | null;
  /**
   * @semantic computed-tone-override — flat tone for toggle-track-off.
   * null = Math.round(dividerTone). Dark: 28.
   */
  toggleTrackOffToneOverride: number | null;
  /**
   * @semantic computed-tone-override — flat tone for toggle-disabled.
   * null = Math.round(surfaceOverlay). Dark: 22.
   */
  toggleDisabledToneOverride: number | null;
  /** @semantic computed-tone-override — base tone for canvas surface formula (surfaceContrast-scaled) */
  bgCanvasToneBase: number;
  /** @semantic computed-tone-override — surfaceContrast midpoint for canvas tone formula */
  bgCanvasToneSCCenter: number;
  /** @semantic computed-tone-override — scale factor for canvas tone formula */
  bgCanvasToneScale: number;
  /** @semantic computed-tone-override — base tone for disabled-bg formula */
  disabledBgBase: number;
  /** @semantic computed-tone-override — scale factor for disabled-bg formula */
  disabledBgScale: number;
  /**
   * @semantic computed-tone-override — border-strong tone unified field.
   * Dark: fgSubtleTone (37).
   */
  borderStrongToneValue: number;

  // ===== Hue Name Dispatch =====
  // Named hue values for resolveHueSlots() branch elimination. String hue names.
  /**
   * @semantic hue-name-dispatch — hue name for the surfScreen derived slot.
   * Dark: "indigo".
   */
  surfScreenHue: string;
  /**
   * @semantic hue-name-dispatch — expression for the fgMuted derived slot hue.
   * "__bare_primary" = use the bare primary segment of txtHue (e.g. "cobalt" from "indigo-cobalt").
   * Any other value = treat as a literal hue name.
   */
  fgMutedHueExpr: string;
  /**
   * @semantic hue-name-dispatch — hue name for the fgSubtle derived slot.
   * Dark: "indigo-cobalt".
   */
  fgSubtleHue: string;
  /**
   * @semantic hue-name-dispatch — hue name for the fgDisabled derived slot.
   * Dark: "indigo-cobalt".
   */
  fgDisabledHue: string;
  /**
   * @semantic hue-name-dispatch — hue name for the fgInverse derived slot.
   * Dark: "sapphire-cobalt".
   */
  fgInverseHue: string;
  /**
   * @semantic hue-name-dispatch — source for the fgPlaceholder derived slot.
   * "fgMuted" = copy from fgMuted slot.
   * "atm"     = copy from atm slot.
   */
  fgPlaceholderSource: string;
  /**
   * @semantic hue-name-dispatch — hue name for the selectionInactive derived slot.
   * Used only when selectionInactiveSemanticMode is true.
   * Dark: "yellow".
   */
  selectionInactiveHue: string;

  // ===== Selection Mode =====
  // Selection behavior mode flags and parameters. Mode-specific boolean + numeric.
  /**
   * @semantic selection-mode — selectionInactive resolution mode flag.
   * When true: use resolveSemanticSlot(selectionInactiveHue) — no warmth bias.
   * When false: compute atm offset (atmBaseAngle - 20°) with warmth bias.
   * Dark: true.
   */
  selectionInactiveSemanticMode: boolean;
  /**
   * @semantic selection-mode — selection-bg-inactive chroma intensity.
   * Dark: 0. Light: 8.
   */
  selectionBgInactiveI: number;
  /**
   * @semantic selection-mode — selection-bg-inactive tone.
   * Dark: 30. Light: 24.
   */
  selectionBgInactiveTone: number;
  /**
   * @semantic selection-mode — selection-bg-inactive alpha.
   * Dark: 25. Light: 20.
   */
  selectionBgInactiveAlpha: number;
}

// ---------------------------------------------------------------------------
// DARK_FORMULAS — Dark recipe formula constants [D01] [D02]
// ---------------------------------------------------------------------------

/**
 * All formula constants for the Dark recipe.
 * Single source of truth for all Dark recipe derivation constants.
 * Exported as the default fallback in `deriveTheme()` via
 * `recipe.formulas ?? DARK_FORMULAS`. [D02]
 *
 * Also referenced by `EXAMPLE_RECIPES.brio.formulas`.
 */
export const DARK_FORMULAS: DerivationFormulas = {
  // ===== Canvas Darkness =====
  // How dark/light the app background is. Dark: tones 5-10. Light: tones 90-95.
  bgAppTone: 5, // near-black: deep immersive app background anchors the dark theme
  bgCanvasTone: 5, // same as bgAppTone: canvas and app share the same base darkness level

  // ===== Surface Layering =====
  // How surfaces stack visually above the canvas. Dark: ascending from ~6. Light: descending from ~95.
  surfaceSunkenTone: 11, // slightly above canvas: just enough lift to distinguish recessed wells
  surfaceDefaultTone: 12, // one step above sunken: the primary card/panel surface
  surfaceRaisedTone: 11, // matches sunken: popovers feel elevated via shadow, not tone contrast
  surfaceOverlayTone: 14, // above default: modals and sheets float clearly above the base layer
  surfaceInsetTone: 6, // near canvas: nested content areas recede toward the background
  surfaceContentTone: 6, // same as inset: text-area-like regions share the deep inset tone
  surfaceScreenTone: 16, // highest tone: full-bleed screen bg pushes cards forward visually

  // ===== Surface Coloring =====
  // How much chroma surfaces carry. Dark: I 2-7. Light: I 3-8.
  atmI: 5, // mid-range chroma: atmosphere hue is present but never saturated on dark bg
  bgAppI: 2, // near-neutral: app bg chroma is barely perceptible, preserving the dark anchor
  bgCanvasI: 2, // same as bgAppI: canvas matches the app-level near-neutral chroma
  surfaceDefaultI: 5, // moderate chroma: cards carry enough hue to feel warm, not sterile
  surfaceRaisedI: 5, // same as default: raised surfaces match default chroma for visual parity
  surfaceOverlayI: 4, // slightly lower: overlays desaturate slightly to recede behind content
  surfaceScreenI: 7, // highest surface chroma: screen bg uses more hue to create depth behind cards
  surfaceInsetI: 5, // matches default: inset wells share the moderate chroma of card surfaces
  surfaceContentI: 5, // same as inset: content areas are consistent with the inset tier
  bgAppSurfaceI: 2, // unified field for bg-app intensity: dark mode uses bgAppI (near-neutral)

  // ===== Text Brightness =====
  // How bright primary and inverse text is. Dark: near 100. Light: near 0.
  fgDefaultTone: 94, // off-white: slightly softened from pure white to reduce eye strain on dark bg
  fgInverseTone: 100, // pure white: inverse text sits on filled controls and must be fully bright

  // ===== Text Hierarchy =====
  // How much secondary/tertiary text dims from primary. Dark: descending from 94. Light: ascending from 8.
  fgMutedTone: 66, // secondary text: large drop from 94 creates clear primary/secondary distinction
  fgSubtleTone: 37, // tertiary text: drops deep to signal low-priority labels and captions
  fgDisabledTone: 23, // near-invisible: disabled content barely readable, signaling non-interactivity
  fgPlaceholderTone: 30, // between disabled and subtle: placeholder is inactive but still scannable

  // ===== Text Coloring =====
  // How much chroma text carries. Dark: I 2-7. Light: I 3-8.
  txtI: 3, // near-neutral: primary text carries minimal chroma so it reads as near-white, not tinted
  txtISubtle: 7, // higher chroma for subtle tiers: tinted labels use more hue to signal semantic meaning
  fgMutedI: 5, // moderate chroma: muted text picks up more hue than primary to compensate for low tone
  atmIBorder: 6, // atmosphere-hued borders use mid-range chroma to stay visible without overpowering
  fgInverseI: 3, // near-neutral: inverse text on filled controls mirrors primary text's low chroma
  fgOnCautionI: 4, // caution surfaces are already vivid; text chroma is moderate to avoid clash
  fgOnSuccessI: 4, // same as caution: success surfaces are vivid, text stays moderate

  // ===== Border Visibility =====
  // How visible borders and dividers are. Dark: subtle I 4-7. Light: crisp I 6-10.
  borderIBase: 6, // mid-range chroma: default borders are present but never stark against dark surfaces
  borderIStrong: 7, // one step higher: strong/emphasis borders need a bit more pop to register
  borderMutedTone: 37, // mid-dark tone: muted borders are dim enough to recede in the hierarchy
  borderMutedI: 7, // higher chroma compensates for low tone so muted borders remain legible
  borderStrongTone: 40, // slightly above muted: strong borders need a touch more lift for contrast
  dividerDefaultI: 6, // matches borderIBase: dividers use the same baseline chroma as borders
  dividerMutedI: 4, // lowest chroma: muted dividers are the most recessive structural element

  // ===== Card Frame Style =====
  // How card title bars and tab bars present. Dark: dim tones 15-18. Light: bright tones 85-92.
  cardFrameActiveI: 12, // elevated chroma: active title bar uses rich hue to signal focus
  cardFrameActiveTone: 18, // above surfaceScreen: active frame floats above the screen background
  cardFrameInactiveI: 4, // near-neutral: inactive frames recede to avoid competing with active card
  cardFrameInactiveTone: 15, // slightly below active: inactive frames are visibly dimmer but still distinct

  // ===== Shadow Depth =====
  // How pronounced shadows and overlay tints are. Dark: 20-80% alpha. Light: 10-40% alpha.
  shadowXsAlpha: 20, // subtle lift: extra-small shadows add just enough depth without visual noise
  shadowMdAlpha: 60, // mid-depth: medium shadows clearly separate floating panels from the surface
  shadowLgAlpha: 70, // deep: large shadows for prominent floats like menus and popovers
  shadowXlAlpha: 80, // heaviest shadow: extra-large conveys maximum elevation for dialogs
  shadowOverlayAlpha: 60, // matches medium: floating overlay panels use the same depth as md shadows
  overlayDimAlpha: 48, // near-half opacity: dim overlay tints content without fully obscuring it
  overlayScrimAlpha: 64, // above dim: modal scrims block the background more assertively
  overlayHighlightAlpha: 6, // near-invisible: highlight tints are barely perceptible, just a suggestion

  // ===== Filled Control Prominence =====
  // How bold filled buttons are. Dark: mid-tone bg. Light: same (filled stays vivid).
  filledBgDarkTone: 20, // dark rest state: dim enough to anchor the hue without washing the button
  filledBgHoverTone: 40, // mid-tone hover: lifts dramatically from rest to signal interactivity
  filledBgActiveTone: 50, // mid-tone press: one more step up from hover to confirm the click

  // ===== Outlined Control Style =====
  // How outlined buttons present across states/modes. Dark: white fg. Light: dark fg.
  outlinedFgRestTone: 100, // pure white fg at rest: outlined buttons use full-brightness text on dark bg
  outlinedFgHoverTone: 100, // same across states: fg tone stays constant; state change is bg alpha
  outlinedFgActiveTone: 100, // same across states
  outlinedFgI: 2, // near-neutral chroma: fg text is nearly achromatic so it reads cleanly over any hue
  outlinedIconRestTone: 100, // pure white icons at rest: mirrors fg tone for visual consistency
  outlinedIconHoverTone: 100, // same across states
  outlinedIconActiveTone: 100, // same across states
  outlinedIconI: 2, // same as fg chroma: icons match text neutrality
  outlinedFgRestToneLight: 0, // light-mode counterpart: inverted polarity — pure black fg on light bg
  outlinedFgHoverToneLight: 0, // same across states (light)
  outlinedFgActiveToneLight: 0, // same across states (light)
  outlinedIconRestToneLight: 0, // light-mode counterpart: black icons mirror black text
  outlinedIconHoverToneLight: 0, // same across states (light)
  outlinedIconActiveToneLight: 0, // same across states (light)
  outlinedOptionBorderRestTone: 50, // mid-tone rest border: visible against both dark and light surfaces
  outlinedOptionBorderHoverTone: 55, // slightly higher on hover: border brightens subtly to indicate focus
  outlinedOptionBorderActiveTone: 60, // highest on press: border lifts to confirm the active state
  outlinedBgHoverI: 0, // sentinel value (0): hover bg uses a hue-slot sentinel path, not direct chroma
  outlinedBgHoverAlphaValue: 10, // low alpha hover tint: 10% opacity wash over the button on hover
  outlinedBgActiveI: 0, // sentinel value (0): press bg also uses sentinel path
  outlinedBgActiveAlphaValue: 20, // double hover alpha on press: 20% opacity confirms the click

  // ===== Ghost Control Style =====
  // How ghost buttons present across states/modes. Dark: white fg. Light: dark fg.
  ghostFgRestTone: 100, // pure white fg at rest: ghost buttons use full-brightness text on dark bg
  ghostFgHoverTone: 100, // same across states: tone stays constant; state change is bg alpha
  ghostFgActiveTone: 100, // same across states
  ghostFgRestI: 2, // near-neutral chroma: ghost fg text is nearly achromatic, matching outlined style
  ghostFgHoverI: 2, // same across states
  ghostFgActiveI: 2, // same across states
  ghostIconRestTone: 100, // pure white icons at rest: mirrors fg tone for visual consistency
  ghostIconHoverTone: 100, // same across states
  ghostIconActiveTone: 100, // same across states
  ghostIconRestI: 2, // near-neutral chroma: ghost icons match text neutrality
  ghostIconHoverI: 2, // same across states
  ghostIconActiveI: 2, // same across states
  ghostBorderI: 20, // elevated chroma for ghost border: provides hue-tinted ring without filled bg
  ghostBorderTone: 60, // mid-bright tone: border is light enough to be visible on dark surfaces
  ghostFgRestToneLight: 0, // light-mode counterpart: inverted polarity — pure black fg on light bg
  ghostFgHoverToneLight: 0, // same across states (light)
  ghostFgActiveToneLight: 0, // same across states (light)
  ghostFgRestILight: 0, // light-mode counterpart: zero chroma — black is achromatic by definition
  ghostFgHoverILight: 0, // same across states (light)
  ghostFgActiveILight: 0, // same across states (light)
  ghostIconRestToneLight: 0, // light-mode counterpart: black icons mirror black text
  ghostIconHoverToneLight: 0, // same across states (light)
  ghostIconActiveToneLight: 0, // same across states (light)
  ghostIconActiveILight: 0, // light-mode counterpart: zero chroma for black icons

  // ===== Badge Style =====
  // How tinted badges present. Dark: bright fg on tinted bg. Light: dark fg on tinted bg.
  badgeTintedFgI: 72, // high chroma fg: badge label text is richly tinted to signal semantic category
  badgeTintedFgTone: 85, // bright fg tone: near-white text on dark tinted bg maintains legibility
  badgeTintedBgI: 65, // vivid bg chroma: badge background carries strong hue to identify category at a glance
  badgeTintedBgTone: 60, // mid-bright bg tone: bright enough to carry chroma, dark enough for dark-mode contrast
  badgeTintedBgAlpha: 15, // low alpha: tinted bg is a translucent wash, not a solid fill
  badgeTintedBorderI: 50, // high border chroma: crisp hue ring frames the badge without a hard fill
  badgeTintedBorderTone: 50, // mid-tone border: sits between fg and bg tones for clean delineation
  badgeTintedBorderAlpha: 35, // moderate border alpha: more opaque than bg to give the ring definition

  // ===== Icon Style =====
  // How icons present in non-control contexts. Dark: bright tones. Light: dark tones.
  iconActiveTone: 80, // bright but not pure white: active icons are vivid without blending into fg text
  iconMutedI: 7, // higher chroma for muted icons: compensates for low tone so the hue still reads
  iconMutedTone: 37, // dim tone: muted icons recede to signal non-primary status

  // ===== Tab Style =====
  // How tabs present. Dark: bright active fg. Light: dark active fg.
  tabFgActiveTone: 90, // near-white active tab label: clearly distinguished from muted inactive tabs

  // ===== Toggle Style =====
  // How toggles present. Dark: bright thumb. Light: dark track.
  toggleTrackOnHoverTone: 45, // mid-tone hover track: lifts from rest to signal the toggle is interactive
  toggleThumbDisabledTone: 40, // dim thumb when disabled: thumb recedes to match the disabled state's low contrast
  toggleTrackDisabledI: 5, // low chroma disabled track: near-neutral to clearly communicate non-interactivity

  // ===== Field Style =====
  // How form fields present. Dark: dark bg tones. Light: light bg tones.
  fieldBgRestTone: 8, // slightly above canvas: field bg is distinct from the app bg but not surface-bright
  fieldBgHoverTone: 11, // matches surfaceDefault: hover lifts the field to the standard surface level
  fieldBgFocusTone: 7, // below rest: focus darkens slightly to signal an inset, focused editing area
  fieldBgDisabledTone: 6, // near-canvas: disabled fields recede to near-background to signal inactivity
  fieldBgReadOnlyTone: 11, // same as hover: read-only shares the raised tone to distinguish from editable rest
  fieldBgRestI: 5, // moderate chroma: field bg carries enough hue to look intentional, not just dark
  disabledBgI: 5, // same as rest chroma: disabled bg retains the hue but the low tone signals the state
  disabledBorderI: 6, // slightly higher chroma border: gives disabled fields a visible edge despite dim tone

  // ===== Hue Slot Dispatch =====
  // Which hue slot each surface/fg/icon/border tier reads from. String keys into ResolvedHueSlots.
  bgAppHueSlot: "canvas", // app bg uses canvas hue: the app background is the canvas itself
  bgCanvasHueSlot: "canvas", // canvas bg uses canvas hue: page-level bg reads from the same root slot
  surfaceSunkenHueSlot: "surfBareBase", // sunken uses bare-base: recessed wells use the neutral surface hue
  surfaceDefaultHueSlot: "surfBareBase", // default surface uses bare-base: standard cards stay close to neutral
  surfaceRaisedHueSlot: "atm", // raised uses atmosphere hue: popovers pick up the atmosphere tint for warmth
  surfaceOverlayHueSlot: "surfBareBase", // overlays use bare-base: modals stay neutral to not distract
  surfaceInsetHueSlot: "atm", // inset uses atmosphere hue: nested content areas warm up with the atm hue
  surfaceContentHueSlot: "atm", // content uses atmosphere hue: text-area regions share the inset warmth
  surfaceScreenHueSlot: "surfScreen", // screen uses its own slot: full-bleed bg uses a dedicated screen hue
  fgMutedHueSlot: "fgMuted", // muted fg uses dedicated slot: secondary text has its own hue resolution path
  fgSubtleHueSlot: "fgSubtle", // subtle fg uses dedicated slot: tertiary text gets its own hue tuning
  fgDisabledHueSlot: "fgDisabled", // disabled fg uses dedicated slot: disabled text resolves independently
  fgPlaceholderHueSlot: "fgPlaceholder", // placeholder uses dedicated slot: placeholder has its own hue path
  fgInverseHueSlot: "fgInverse", // inverse fg uses fgInverse slot: on-filled text resolves from its own slot
  fgOnAccentHueSlot: "fgInverse", // on-accent fg shares fgInverse: accent surfaces use the same on-filled path
  iconMutedHueSlot: "fgSubtle", // muted icons share fgSubtle: muted icons align with subtle text hue
  iconOnAccentHueSlot: "fgInverse", // on-accent icons share fgInverse: icons on fills use the same slot as text
  dividerMutedHueSlot: "borderTintBareBase", // muted dividers use border tint: dividers pull from the border hue family
  disabledBgHueSlot: "surfBareBase", // disabled bg uses bare-base: disabled surfaces stay neutral
  fieldBgHoverHueSlot: "surfBareBase", // field hover uses bare-base: fields stay neutral on hover
  fieldBgReadOnlyHueSlot: "surfBareBase", // read-only uses bare-base: read-only fields match the neutral surface
  fieldPlaceholderHueSlot: "fgPlaceholder", // field placeholder shares fgPlaceholder: consistent with text placeholder
  fieldBorderRestHueSlot: "fgPlaceholder", // rest border shares fgPlaceholder: border and placeholder are tonally paired
  fieldBorderHoverHueSlot: "fgSubtle", // hover border shifts to fgSubtle: border lifts to a more visible hue slot on focus
  toggleTrackDisabledHueSlot: "surfBareBase", // disabled track uses bare-base: neutral track signals off/disabled
  toggleThumbHueSlot: "fgInverse", // thumb uses fgInverse: thumb sits on the track like text on a filled surface
  checkmarkHueSlot: "fgInverse", // checkmark uses fgInverse: check icon is on a filled bg, same as on-filled text
  radioDotHueSlot: "fgInverse", // radio dot uses fgInverse: same rationale as checkmark — on-filled context
  tabBgActiveHueSlot: "cardFrame", // active tab bg uses cardFrame: active tab shares the card frame hue slot
  tabBgInactiveHueSlot: "cardFrame", // inactive tab bg uses cardFrame: both states read from the same frame slot

  // ===== Sentinel Hue Dispatch =====
  // Which sentinel hue slot hover/active backgrounds use. String keys (__highlight, __verboseHighlight, etc.).
  outlinedBgHoverHueSlot: "__highlight", // outlined hover uses __highlight sentinel: triggers alpha-based hover wash
  outlinedBgActiveHueSlot: "__highlight", // outlined active uses __highlight sentinel: same path, higher alpha
  ghostActionBgHoverHueSlot: "__highlight", // ghost action hover uses __highlight: same sentinel as outlined hover
  ghostActionBgActiveHueSlot: "__highlight", // ghost action active uses __highlight: same sentinel, higher alpha
  ghostOptionBgHoverHueSlot: "__highlight", // ghost option hover uses __highlight: options share action sentinel
  ghostOptionBgActiveHueSlot: "__highlight", // ghost option active uses __highlight: same sentinel path
  tabBgHoverHueSlot: "__highlight", // tab hover uses __highlight: tabs use the same interactive sentinel
  tabCloseBgHoverHueSlot: "__highlight", // tab close hover uses __highlight: close button shares the tab sentinel
  highlightHoverHueSlot: "__verboseHighlight", // highlight hover uses __verboseHighlight: verbose path for selection highlights

  // ===== Sentinel Alpha =====
  // Alpha values for sentinel-dispatched hover/active tokens. Percentage values 5-20.
  tabBgHoverAlpha: 8, // slightly below outlined hover: tabs are less prominent interactive targets
  tabCloseBgHoverAlpha: 12, // above tab hover: close button needs a stronger signal to feel safe to tap
  outlinedBgHoverAlpha: 10, // standard hover wash: 10% opacity is the baseline for interactive hover states
  outlinedBgActiveAlpha: 20, // double hover on press: 20% confirms the click with a clear visual step
  ghostActionBgHoverAlpha: 10, // same as outlined hover: ghost actions share the baseline hover alpha
  ghostActionBgActiveAlpha: 20, // same as outlined active: ghost actions share the baseline press alpha
  ghostOptionBgHoverAlpha: 10, // same across ghost types: option hover matches action hover
  ghostOptionBgActiveAlpha: 20, // same across ghost types: option press matches action press
  highlightHoverAlpha: 5, // half of standard hover: selection highlights are very subtle by design
  ghostDangerBgHoverAlpha: 10, // same as standard hover: danger ghost uses the baseline hover wash
  ghostDangerBgActiveAlpha: 20, // same as standard active: danger ghost uses the baseline press alpha

  // ===== Computed Tone Override =====
  // Flat-value overrides for computed tones and formula parameters. number or null.
  dividerDefaultToneOverride: 17, // just above surfaceScreen: dividers sit slightly brighter than screen bg
  dividerMutedToneOverride: 15, // below default divider: muted dividers recede further toward the background
  disabledFgToneValue: 38, // above fgDisabled (23): disabled interactive text is slightly more legible than disabled labels
  disabledBorderToneOverride: 28, // between disabled fg and canvas: disabled borders are dim but still structural
  outlinedBgRestToneOverride: null, // null: let formula derive rest bg from surfaceInset; avoids hardcoding a tone that must stay in sync
  outlinedBgHoverToneOverride: null, // null: hover bg tone is governed by sentinel alpha path, not a fixed tone
  outlinedBgActiveToneOverride: null, // null: press bg tone is governed by sentinel alpha path, not a fixed tone
  toggleTrackOffToneOverride: 28, // dim track when off: off-state track is clearly below the on-state brightness
  toggleDisabledToneOverride: 22, // near-disabled fg tone: disabled toggle is visually equivalent to disabled text
  bgCanvasToneBase: 5, // matches bgCanvasTone: base canvas tone before surfaceContrast modulation
  bgCanvasToneSCCenter: 50, // center of surfaceContrast range: no shift at knob midpoint
  bgCanvasToneScale: 8, // ±8 tone units at extremes: surfaceContrast modulates canvas tone across an 8-step range
  disabledBgBase: 22, // above canvas, below active surfaces: disabled bg is distinct but recessive
  disabledBgScale: 0, // zero scale: disabled bg does not modulate with surfaceContrast knob
  borderStrongToneValue: 37, // just below fgSubtle (37): strong borders align with the subtle text tier for visual harmony

  // ===== Hue Name Dispatch =====
  // Named hue values for resolveHueSlots() branch elimination. String hue names.
  surfScreenHue: "indigo", // indigo screen bg: cool blue-violet depth behind cards in the dark theme
  fgMutedHueExpr: "__bare_primary", // bare-primary sentinel: muted fg derives hue from the recipe's primary color
  fgSubtleHue: "indigo-cobalt", // indigo-cobalt subtle text: cool blue adds depth to tertiary labels
  fgDisabledHue: "indigo-cobalt", // same as subtle: disabled text uses the same cool hue family, just dimmer
  fgInverseHue: "sapphire-cobalt", // sapphire-cobalt inverse: on-filled text uses a slightly warmer blue to complement fills
  fgPlaceholderSource: "fgMuted", // placeholder derives from fgMuted: placeholder hue tracks secondary text rather than a fixed name
  selectionInactiveHue: "yellow", // yellow inactive selection: warm yellow makes inactive selections visible without competing with blue focus

  // ===== Selection Mode =====
  // Selection behavior mode flags and parameters. Mode-specific boolean + numeric.
  selectionInactiveSemanticMode: true, // semantic mode on: inactive selection uses the named hue, not a sentinel path
  selectionBgInactiveI: 0, // zero chroma: inactive selection bg uses alpha alone — the yellow hue provides identity
  selectionBgInactiveTone: 30, // dim tone: inactive selection bg is dark enough to not overpower content
  selectionBgInactiveAlpha: 25, // low-moderate alpha: inactive selection is clearly visible but doesn't obscure text
};

// ---------------------------------------------------------------------------
// BASE_FORMULAS + DARK_OVERRIDES — theme family pattern [D03]
// ---------------------------------------------------------------------------

/**
 * Default formula values shared across all recipes.
 * `DARK_FORMULAS = { ...BASE_FORMULAS, ...DARK_OVERRIDES }`.
 * Future light / stark recipes override only the fields that differ. [D03]
 */
export const BASE_FORMULAS: DerivationFormulas = DARK_FORMULAS;

/**
 * Fields that are specific to the Dark recipe and differ from BASE_FORMULAS.
 * Currently empty because BASE_FORMULAS IS the Dark recipe.
 * Future theme families will populate this with their diverging values.
 */
export const DARK_OVERRIDES: Partial<DerivationFormulas> = {};

// ---------------------------------------------------------------------------
// LIGHT_OVERRIDES + LIGHT_FORMULAS — light theme formula overrides [D04]
// ---------------------------------------------------------------------------

/**
 * Formula fields that differ from BASE_FORMULAS for a light-polarity recipe.
 * Every field is annotated with its design rationale, mirroring the annotation
 * style of DARK_FORMULAS.
 *
 * Fields omitted here are mode-independent — the dark default is correct for
 * light mode too (e.g., hue-slot-dispatch, sentinel-hue-dispatch, most
 * sentinel-alpha values, hue-name-dispatch except surfScreenHue and
 * fgPlaceholderSource).
 *
 * `LIGHT_FORMULAS = { ...BASE_FORMULAS, ...LIGHT_OVERRIDES }` is the
 * complete light recipe formula bundle. [D04]
 */
export const LIGHT_OVERRIDES: Partial<DerivationFormulas> = {
  // ===== Canvas Darkness =====
  // Light mode: near-white canvas. Inverse of dark's near-black tones 5.
  bgAppTone: 95, // near-white: light app background anchors the open, airy theme
  bgCanvasTone: 95, // same as bgAppTone: canvas and app share the same near-white base

  // ===== Surface Layering =====
  // Light mode: surfaces descend from near-white. Visual stacking is inverted —
  // lower tone = visually "deeper" (darker). At surfaceContrast=50, surfaces
  // step down from 95 toward 85 as they layer higher.
  surfaceSunkenTone: 88, // below canvas: recessed wells are visibly darker to show depth
  surfaceDefaultTone: 90, // standard card surface: slightly below canvas for clear definition
  surfaceRaisedTone: 92, // above default: popovers lift slightly (shadow adds more distinction)
  surfaceOverlayTone: 93, // near-white overlay: modals are light but slightly brighter than default
  surfaceInsetTone: 86, // below default: nested content areas recede visibly into the card
  surfaceContentTone: 86, // same as inset: text-area regions share the deep inset tone
  surfaceScreenTone: 85, // lowest tone: full-bleed screen bg is the darkest surface, pushing cards forward

  // ===== Surface Coloring =====
  // Light mode: slightly more chroma than dark to avoid washed-out appearance.
  atmI: 6, // moderate chroma: atmosphere hue is present and readable on light surfaces
  bgAppI: 3, // near-neutral app bg: barely tinted to preserve the clean light anchor
  bgCanvasI: 3, // same as bgAppI: canvas matches app-level near-neutral chroma
  surfaceDefaultI: 6, // moderate chroma: cards carry enough hue to feel warm, not clinical
  surfaceRaisedI: 6, // same as default: raised surfaces match default chroma for visual parity
  surfaceOverlayI: 5, // slightly lower: overlays desaturate slightly to recede behind content
  surfaceScreenI: 8, // highest surface chroma: screen bg uses more hue to create depth behind cards
  surfaceInsetI: 6, // matches default: inset wells share the moderate chroma of card surfaces
  surfaceContentI: 6, // same as inset: content areas are consistent with the inset tier
  bgAppSurfaceI: 3, // unified field for bg-app intensity: light mode uses near-neutral bgAppI

  // ===== Text Brightness =====
  // Light mode: near-black text on light surfaces. Inverse of dark's near-white.
  fgDefaultTone: 8, // near-black: primary text is deeply dark to contrast against light surfaces
  fgInverseTone: 94, // near-white: inverse text sits on filled controls — stays near-white for legibility

  // ===== Text Hierarchy =====
  // Light mode: ascending from 8 (darker = more primary, lighter = less prominent).
  // Polarity is inverted from dark mode's descending-from-94 scale.
  fgMutedTone: 34, // secondary text: mid-dark tone clearly distinguishable from primary near-black
  fgSubtleTone: 52, // tertiary text: lighter mid-tone signals low priority labels and captions
  fgDisabledTone: 68, // near-mid: disabled content is clearly de-emphasized against light bg
  fgPlaceholderTone: 60, // between disabled and subtle: placeholder is inactive but still scannable

  // ===== Text Coloring =====
  // Light mode: slightly more chroma to compensate for high-tone text being less saturated.
  txtI: 4, // near-neutral with slight lift: primary text carries a hint of hue for warmth
  txtISubtle: 8, // higher chroma for subtle tiers: tinted labels use more hue to signal semantic meaning
  fgMutedI: 6, // moderate chroma: muted text picks up more hue to stay warm and readable
  atmIBorder: 7, // atmosphere-hued borders use higher chroma on light bg to stay visible
  fgInverseI: 3, // near-neutral: inverse text on filled controls mirrors primary text's low chroma
  fgOnCautionI: 5, // caution surfaces are vivid; text chroma is moderate on light to avoid wash
  fgOnSuccessI: 5, // same as caution: success surfaces are vivid, text stays moderate

  // ===== Border Visibility =====
  // Light mode: crisp borders need higher intensity to be visible against light surfaces.
  borderIBase: 8, // crisp chroma: default borders need more saturation to register on light bg
  borderIStrong: 10, // highest chroma: strong borders are clearly visible and assertive
  borderMutedTone: 62, // mid-light tone: muted borders are visible but recessive on light surfaces
  borderMutedI: 8, // higher chroma: compensates for light-tone dilution to keep muted borders legible
  borderStrongTone: 52, // mid-tone: strong borders are darker than muted for clear emphasis
  dividerDefaultI: 7, // matches borderIBase: dividers use the same crisp baseline as borders
  dividerMutedI: 5, // lower than default: muted dividers are the most recessive structural element

  // ===== Card Frame Style =====
  // Light mode: bright tones (vs dark's dim tones 15-18). Frames sit just below canvas.
  cardFrameActiveI: 12, // elevated chroma: active title bar uses rich hue to signal focus
  cardFrameActiveTone: 88, // just below canvas: active frame is clearly lighter than the canvas bg
  cardFrameInactiveI: 5, // near-neutral: inactive frames recede without competing with active card
  cardFrameInactiveTone: 85, // slightly below active: inactive frames are visibly dimmer but still distinct

  // ===== Shadow Depth =====
  // Light mode: lighter shadow alphas — shadows on light bg are less dramatic.
  shadowXsAlpha: 10, // subtle: extra-small shadows add depth without visual weight
  shadowMdAlpha: 25, // light-moderate: medium shadows separate floating panels clearly
  shadowLgAlpha: 35, // moderate: large shadows for prominent floats like menus
  shadowXlAlpha: 40, // heaviest light-mode shadow: conveys maximum elevation for dialogs
  shadowOverlayAlpha: 30, // slightly above medium: floating overlay panels need clear separation
  overlayDimAlpha: 32, // ~one-third opacity: dim overlay tints without fully obscuring content
  overlayScrimAlpha: 48, // above dim: modal scrims block the background more assertively
  overlayHighlightAlpha: 4, // barely visible: highlight tints are very subtle on light surfaces

  // ===== Filled Control Prominence =====
  // Light mode: filled controls stay vivid — same tone approach as dark (mid-tone vivid fill).
  filledBgDarkTone: 20, // dark rest state: same as dark — filled buttons stay bold and vivid
  filledBgHoverTone: 40, // same as dark: hover lifts dramatically to signal interactivity
  filledBgActiveTone: 50, // same as dark: press confirms with one more step up

  // ===== Outlined Control Style =====
  // Light mode uses the *Light tone fields for fg/icon.
  // outlinedFgRestTone/HoverTone/ActiveTone are dark-mode; light reads *ToneLight.
  // Light-mode fields already set to 0 (black) in DARK_FORMULAS (correct for light).
  // outlinedBgHoverI / outlinedBgActiveI: light mode uses direct chroma, not sentinel.
  outlinedBgHoverI: 4, // direct chroma: light-mode hover bg is a solid tinted surface, not alpha sentinel
  outlinedBgHoverAlphaValue: 100, // fully opaque: light-mode hover bg is a solid surface (no alpha wash)
  outlinedBgActiveI: 6, // higher chroma: press bg is more saturated than hover for clear click feedback
  outlinedBgActiveAlphaValue: 100, // fully opaque: press bg is also solid

  // ===== Ghost Control Style =====
  // Light mode: fg/icon tones use *ToneLight fields (set to 0/black in DARK_FORMULAS — correct for light).
  // Ghost border needs a higher, darker tone to be visible on light surfaces.
  ghostBorderI: 20, // same elevated chroma: visible hue-tinted ring without filled bg
  ghostBorderTone: 35, // darker tone: border must be dark enough to show against light surfaces

  // ===== Badge Style =====
  // Light mode: dark fg on tinted bg (inverse of dark's bright fg on dark bg).
  badgeTintedFgI: 72, // high chroma fg: badge label text is richly tinted
  badgeTintedFgTone: 15, // near-black fg: dark text on light tinted bg for maximum legibility
  badgeTintedBgI: 65, // vivid bg chroma: badge background carries strong hue to identify category
  badgeTintedBgTone: 80, // light bg tone: bright tinted wash on light surface
  badgeTintedBgAlpha: 20, // slightly higher alpha than dark: light tinted bg needs more opacity to show
  badgeTintedBorderI: 50, // high border chroma: crisp hue ring frames the badge
  badgeTintedBorderTone: 40, // mid-dark border: darker than bg to give the ring clear definition on light bg
  badgeTintedBorderAlpha: 40, // slightly more opaque than bg: border ring stands out from the tinted wash

  // ===== Icon Style =====
  // Light mode: dark tones for icons on light backgrounds (inverse of dark's bright tones).
  iconActiveTone: 20, // near-dark: active icons are vivid and dark without blending into text
  iconMutedI: 7, // same chroma: compensates for mid-tone to keep hue readable
  iconMutedTone: 52, // mid-tone: muted icons recede on light bg without disappearing

  // ===== Tab Style =====
  // Light mode: dark active fg on light tab bar.
  tabFgActiveTone: 10, // near-black: clearly distinguished from muted inactive tabs on light frame

  // ===== Toggle Style =====
  // Light mode: dark track on light bg.
  toggleTrackOnHoverTone: 35, // darker than dark-mode hover: track must be darker to show on light bg
  toggleThumbDisabledTone: 65, // mid-light thumb when disabled: recedes on light surface
  toggleTrackDisabledI: 5, // same low chroma: neutral to clearly communicate non-interactivity

  // ===== Field Style =====
  // Light mode: light bg tones (near-white, stepping from canvas tone).
  fieldBgRestTone: 91, // just below canvas: field bg is distinct from app bg but stays light
  fieldBgHoverTone: 88, // matches surfaceDefault: hover steps down for clear hover feedback
  fieldBgFocusTone: 92, // slightly above rest: focus brightens slightly to signal an active editing area
  fieldBgDisabledTone: 94, // near-canvas: disabled fields recede toward bg to signal inactivity
  fieldBgReadOnlyTone: 88, // same as hover: read-only shares raised distinction from editable rest
  fieldBgRestI: 5, // moderate chroma: field carries enough hue to look intentional
  disabledBgI: 4, // slightly lower: disabled bg retains the hue softly
  disabledBorderI: 6, // same: gives disabled fields a visible edge despite light-mode tone

  // ===== Computed Tone Override =====
  // Light mode: dividers and disabled controls are recalibrated for light surfaces.
  dividerDefaultToneOverride: 78, // mid-light tone: dividers are visible on light surfaces without being harsh
  dividerMutedToneOverride: 82, // lighter than default divider: muted dividers recede further
  disabledFgToneValue: 62, // above fgDisabled (68): slightly more legible than fully disabled labels
  disabledBorderToneOverride: 72, // lighter than dark: disabled borders are visible but clearly passive
  outlinedBgRestToneOverride: null, // null: let formula derive rest bg from surfaceInset
  outlinedBgHoverToneOverride: null, // null: hover bg governed by direct I/alpha path in light mode
  outlinedBgActiveToneOverride: null, // null: press bg governed by direct I/alpha path in light mode
  toggleTrackOffToneOverride: 72, // lighter off-track: clearly below on-state brightness on light bg
  toggleDisabledToneOverride: 80, // near-light: disabled toggle is visually equivalent to disabled state
  bgCanvasToneBase: 95, // matches bgCanvasTone: base canvas tone before surfaceContrast modulation
  bgCanvasToneSCCenter: 50, // center of surfaceContrast range: no shift at knob midpoint
  bgCanvasToneScale: 8, // same ±8 range: surfaceContrast modulates canvas across an 8-step range
  disabledBgBase: 78, // lighter than dark's 22: disabled bg is distinct but recessive on light bg
  disabledBgScale: 0, // zero scale: disabled bg does not modulate with surfaceContrast knob
  borderStrongToneValue: 40, // mid-dark: strong borders align with the subtle text tier for visual harmony

  // ===== Hue Name Dispatch =====
  // Light mode overrides for derived hue slots that differ from dark.
  surfScreenHue: "cobalt", // cobalt screen bg: light surface screen uses text hue for continuity
  fgPlaceholderSource: "atm", // placeholder derives from atm: light-mode placeholder uses surface hue for softness

  // ===== Selection Mode =====
  // Light mode: atm-offset path for inactive selection (more natural on light canvas).
  selectionInactiveSemanticMode: false, // atm-offset mode: inactive selection uses warmth-biased atm hue - 20°
  selectionBgInactiveI: 8, // moderate chroma: selection tint is visibly colored on light surfaces
  selectionBgInactiveTone: 80, // light-mode tone: selection bg is mid-light to show through without obscuring
  selectionBgInactiveAlpha: 30, // slightly higher alpha: selection is clearly visible on light canvas
};

/**
 * Complete formula bundle for a light-polarity recipe.
 * `BASE_FORMULAS` provides all dark defaults; `LIGHT_OVERRIDES` patches every
 * field that differs in light mode.
 *
 * Use this as `formulas` in any light-mode `ThemeRecipe`. [D04]
 */
export const LIGHT_FORMULAS: DerivationFormulas = { ...BASE_FORMULAS, ...LIGHT_OVERRIDES };

// ---------------------------------------------------------------------------
// EXAMPLE_RECIPES — reference recipe
// ---------------------------------------------------------------------------

/**
 * Reference recipe for Brio (default dark).
 * From roadmap/theme-generator-proposal.md [D04].
 */
export const EXAMPLE_RECIPES: Record<string, ThemeRecipe> = {
  brio: {
    name: "brio",
    description: "Deep, immersive dark theme. Very dark surfaces with subtle layering. Near-white text with wide hierarchy spread. Filled controls are prominent with vivid accent backgrounds and white text. Borders are subtle. Shadows are moderate. Industrial warmth with muted chassis and vivid signals.",
    mode: "dark",
    cardBg: { hue: "indigo-violet" },
    text: { hue: "cobalt" },
    link: "cyan",            // [D05]: link/selection/highlight use cyan; active stays blue
    canvas: "indigo-violet", // bg-canvas, bg-app use same hue as cardBg
    cardFrame: "indigo",     // card title bar, tab bar bg
    borderTint: "indigo-violet", // borders and dividers use same hue as cardBg
    formulas: { ...BASE_FORMULAS, ...DARK_OVERRIDES },
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective hue angle for a named hue.
 * Handles bare names ("violet"), hyphenated adjacency ("indigo-violet"),
 * and the special names "black" and "white".
 * Returns the hue angle in degrees (0-360).
 */
function resolveHueAngle(hue: string): number {
  // Check if it's a known base name first
  if (hue in HUE_FAMILIES) return HUE_FAMILIES[hue];
  // Check for hyphenated adjacency: "A-B" where A and B are both known hues
  const hyphenIdx = hue.lastIndexOf("-");
  if (hyphenIdx > 0) {
    const left = hue.slice(0, hyphenIdx);
    const right = hue.slice(hyphenIdx + 1);
    if (left in HUE_FAMILIES && right in HUE_FAMILIES) {
      return resolveHyphenatedHue(left, right);
    }
  }
  return HUE_FAMILIES["cobalt"]; // fallback to cobalt
}

// ---------------------------------------------------------------------------
// HUE_VOCABULARY — precomputed 144-entry name-to-angle map (48 base + 96 hyphenated)
// Built at module load time; reused by formatHueRef and closestHueName.
// ---------------------------------------------------------------------------

/**
 * All 144 expressible hue points: 48 base names + 96 adjacent hyphenated pairs.
 * Keys are the string expression (e.g. "cobalt", "indigo-cobalt").
 * Values are the resolved hue angle in degrees.
 */
const HUE_VOCABULARY: Record<string, number> = (() => {
  const vocab: Record<string, number> = {};
  // 48 base names
  for (const [name, angle] of Object.entries(HUE_FAMILIES)) {
    vocab[name] = angle;
  }
  // 96 adjacent hyphenated pairs (each adjacent pair A-B and B-A)
  const len = ADJACENCY_RING.length;
  for (let i = 0; i < len; i++) {
    const a = ADJACENCY_RING[i];
    const b = ADJACENCY_RING[(i + 1) % len];
    vocab[`${a}-${b}`] = resolveHyphenatedHue(a, b);
    vocab[`${b}-${a}`] = resolveHyphenatedHue(b, a);
  }
  return vocab;
})();

/**
 * Find the closest entry in HUE_VOCABULARY (144 entries) to a given angle (degrees).
 * Returns the name string (may be a base name or hyphenated adjacency expression).
 */
function closestHueName(angle: number): string {
  let best = "violet";
  let bestDiff = Infinity;
  for (const [name, h] of Object.entries(HUE_VOCABULARY)) {
    let diff = Math.abs(angle - h);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = name;
    }
  }
  return best;
}

/**
 * Format a hue reference by finding the closest named or hyphenated entry in
 * HUE_VOCABULARY (144 entries). Returns a bare name ("cobalt") or a hyphenated
 * adjacency expression ("indigo-cobalt") — never a numeric offset.
 */
function formatHueRef(_namedHue: string, targetAngle: number): string {
  return closestHueName(targetAngle);
}

// ---------------------------------------------------------------------------
// Warmth bias helpers — module scope (moved from inside deriveTheme for reuse)
// ---------------------------------------------------------------------------

/**
 * Hues that receive warmth bias when the recipe warmth knob is != 50.
 * Vivid signal hues (red, orange, yellow, green, cyan, etc.) are unaffected.
 * For hyphenated names, the primary (dominant) hue determines membership.
 */
export const ACHROMATIC_ADJACENT_HUES: ReadonlySet<string> = new Set([
  "violet", "cobalt", "blue", "indigo", "purple", "sky",
  "sapphire", "iris", "cerulean",
]);

/**
 * Extract the primary base color name from a hue expression.
 * "cobalt" -> "cobalt", "indigo-cobalt" -> "indigo", "indigo-violet" -> "indigo".
 */
export function primaryColorName(hueExpr: string): string {
  const hyphenIdx = hueExpr.indexOf("-");
  return hyphenIdx > 0 ? hueExpr.slice(0, hyphenIdx) : hueExpr;
}

/**
 * Apply warmth bias to a hue angle when the hue is achromatic-adjacent.
 * warmthBias is (warmth - 50) / 50 * 12 degrees (±12° at extremes).
 * Non-achromatic hues are returned unchanged.
 */
export function applyWarmthBias(hueName: string, angle: number, warmthBias: number): number {
  const primary = primaryColorName(hueName);
  if (!ACHROMATIC_ADJACENT_HUES.has(primary)) return angle;
  return (angle + warmthBias + 360) % 360;
}

// ---------------------------------------------------------------------------
// resolveHueSlots — Layer 1: recipe + warmth -> ResolvedHueSlots (Spec S02)
// ---------------------------------------------------------------------------

/**
 * Resolve all hue slots for a recipe, applying warmth bias to
 * achromatic-adjacent hues and deriving all per-tier hues.
 *
 * This is Layer 1 of the three-layer derivation pipeline (Spec S01).
 * The output `ResolvedHueSlots` is the canonical source for all hue angles
 * and refs used in token derivation.
 *
 * Per-tier derived hue slots (surfScreen, fgMuted, fgSubtle, fgDisabled,
 * fgInverse, fgPlaceholder, selectionInactive) are driven by
 * `formulas` fields when `recipe.formulas` is present, eliminating
 * all runtime mode branches from the formula path. [D03]
 *
 * @param recipe  - The theme recipe
 * @param warmth  - Warmth knob value (0-100, default 50)
 * @param formulas - Formula constants; defaults to recipe.formulas ?? DARK_FORMULAS
 */
export function resolveHueSlots(
  recipe: ThemeRecipe,
  warmth: number,
  formulas: DerivationFormulas = recipe.formulas ?? DARK_FORMULAS,
): ResolvedHueSlots {
  const warmthBias = ((warmth - 50) / 50) * 12; // ±12° at extremes

  /** Build a ResolvedHueSlot from a hue name, applying warmth bias. */
  function resolveSlot(hueName: string): ResolvedHueSlot {
    const rawAngle = resolveHueAngle(hueName);
    const angle = applyWarmthBias(hueName, rawAngle, warmthBias);
    const name = closestHueName(angle);
    const ref = formatHueRef(name, angle);
    const pName = primaryColorName(name);
    return { angle, name, ref, primaryName: pName };
  }

  /** Build a ResolvedHueSlot for a semantic hue (no warmth bias). */
  function resolveSemanticSlot(hueName: string): ResolvedHueSlot {
    const angle = resolveHueAngle(hueName);
    const name = closestHueName(angle);
    const ref = formatHueRef(name, angle);
    const pName = primaryColorName(name);
    return { angle, name, ref, primaryName: pName };
  }

  /** Build a ResolvedHueSlot directly from an already-resolved angle. */
  function slotFromAngle(angle: number): ResolvedHueSlot {
    const name = closestHueName(angle);
    const ref = formatHueRef(name, angle);
    const pName = primaryColorName(name);
    return { angle, name, ref, primaryName: pName };
  }

  // -------------------------------------------------------------------------
  // Recipe hues
  // -------------------------------------------------------------------------
  const atmHue = recipe.cardBg.hue;
  const txtHue = recipe.text.hue;
  const canvasHue = recipe.canvas ?? atmHue;
  const cardFrameHue = recipe.cardFrame ?? "indigo";
  const borderTintHue = recipe.borderTint ?? atmHue;
  const interactiveHue = recipe.link ?? recipe.active ?? "blue";
  const activeHue = recipe.active ?? "blue";
  const accentHue = recipe.accent ?? "orange";

  const atm = resolveSlot(atmHue);
  const txt = resolveSlot(txtHue);
  const canvas = resolveSlot(canvasHue);
  const cardFrame = resolveSlot(cardFrameHue);
  const borderTint = resolveSlot(borderTintHue);
  const interactive = resolveSemanticSlot(interactiveHue);
  const active = resolveSemanticSlot(activeHue);
  const accent = resolveSemanticSlot(accentHue);

  // Semantic hues — no warmth bias
  const destructive = resolveSemanticSlot(recipe.destructive ?? "red");
  const success = resolveSemanticSlot(recipe.success ?? "green");
  const caution = resolveSemanticSlot(recipe.caution ?? "yellow");
  const agent = resolveSemanticSlot(recipe.agent ?? "violet");
  const data = resolveSemanticSlot(recipe.data ?? "teal");

  // -------------------------------------------------------------------------
  // Per-tier derived hues
  // -------------------------------------------------------------------------

  // surfBareBase: bare base of atm hue (last segment of hyphenated name).
  // "indigo-violet" -> "violet"; "cobalt" -> "cobalt"
  const atmBareBaseName = (() => {
    const hyphenIdx = atmHue.lastIndexOf("-");
    if (hyphenIdx > 0) {
      const lastSeg = atmHue.slice(hyphenIdx + 1);
      if (lastSeg in HUE_FAMILIES) return lastSeg;
    }
    return closestHueName(resolveHueAngle(atmHue));
  })();
  const surfBareBaseRawAngle = HUE_FAMILIES[atmBareBaseName] ?? resolveHueAngle(atmHue);
  const surfBareBaseAngle = applyWarmthBias(atmBareBaseName, surfBareBaseRawAngle, warmthBias);
  const surfBareBase: ResolvedHueSlot = {
    angle: surfBareBaseAngle,
    name: closestHueName(surfBareBaseAngle),
    ref: atmBareBaseName, // direct named reference (matches existing deriveTheme logic)
    primaryName: atmBareBaseName,
  };

  // surfScreen: driven by formulas.surfScreenHue. [D03]
  // When surfScreenHue equals txtHue, copy the txt slot (light-mode equivalent);
  // otherwise resolve it as a named hue with warmth bias.
  const surfScreen: ResolvedHueSlot = formulas.surfScreenHue === txtHue
    ? { ...txt }
    : (() => {
        const angle = applyWarmthBias(
          formulas.surfScreenHue,
          resolveHueAngle(formulas.surfScreenHue),
          warmthBias,
        );
        return slotFromAngle(angle);
      })();

  // fgMuted: driven by formulas.fgMutedHueExpr. [D03]
  // "__bare_primary" → bare primary of txtHue (dark-mode default).
  // Any other value → treat as a literal hue name.
  const fgMutedHueName = formulas.fgMutedHueExpr === "__bare_primary"
    ? (() => {
        const primary = primaryColorName(txtHue);
        return primary in HUE_FAMILIES ? primary : txtHue;
      })()
    : formulas.fgMutedHueExpr;
  const fgMutedRawAngle = resolveHueAngle(fgMutedHueName);
  const fgMutedAngle = applyWarmthBias(fgMutedHueName, fgMutedRawAngle, warmthBias);
  const fgMutedName = closestHueName(fgMutedAngle);
  const fgMuted: ResolvedHueSlot = {
    angle: fgMutedAngle,
    name: fgMutedName,
    // ref: use bare name directly when it's a known family (matches existing logic)
    ref: fgMutedHueName in HUE_FAMILIES ? fgMutedHueName : fgMutedName,
    primaryName: primaryColorName(fgMutedName),
  };

  // fgSubtle: driven by formulas.fgSubtleHue. [D03]
  const fgSubtleHueName = formulas.fgSubtleHue;
  const fgSubtleAngle = applyWarmthBias(primaryColorName(fgSubtleHueName), resolveHueAngle(fgSubtleHueName), warmthBias);
  const fgSubtle = slotFromAngle(fgSubtleAngle);

  // fgDisabled: driven by formulas.fgDisabledHue. [D03]
  const fgDisabledHueName = formulas.fgDisabledHue;
  const fgDisabledAngle = applyWarmthBias(primaryColorName(fgDisabledHueName), resolveHueAngle(fgDisabledHueName), warmthBias);
  const fgDisabled = slotFromAngle(fgDisabledAngle);

  // fgInverse: driven by formulas.fgInverseHue. [D03]
  const fgInverseHueName = formulas.fgInverseHue;
  const fgInverseAngle = applyWarmthBias(primaryColorName(fgInverseHueName), resolveHueAngle(fgInverseHueName), warmthBias);
  const fgInverse = slotFromAngle(fgInverseAngle);

  // fgPlaceholder: driven by formulas.fgPlaceholderSource. [D03]
  // "fgMuted" → copy fgMuted slot; "atm" → copy atm slot.
  const fgPlaceholder: ResolvedHueSlot =
    formulas.fgPlaceholderSource === "atm" ? { ...atm } : { ...fgMuted };

  // selectionInactive: driven by formulas.selectionInactiveSemanticMode. [D03]
  // true  → resolveSemanticSlot(selectionInactiveHue) — no warmth bias (dark default)
  // false → compute atm offset: atmBaseAngle - 20° with warmth bias (light-mode style)
  const selectionInactive: ResolvedHueSlot = formulas.selectionInactiveSemanticMode
    ? resolveSemanticSlot(formulas.selectionInactiveHue)
    : (() => {
        const atmBaseAngle = resolveHueAngle(atmHue);
        const selAngle = applyWarmthBias(atmHue, (atmBaseAngle - 20 + 360) % 360, warmthBias);
        return slotFromAngle(selAngle);
      })();

  // borderTintBareBase: same logic as surfBareBase but for borderTint hue.
  const borderTintBareBaseName = (() => {
    const hyphenIdx = borderTintHue.lastIndexOf("-");
    if (hyphenIdx > 0) {
      const lastSeg = borderTintHue.slice(hyphenIdx + 1);
      if (lastSeg in HUE_FAMILIES) return lastSeg;
    }
    return closestHueName(resolveHueAngle(borderTintHue));
  })();
  const borderTintBareRawAngle = HUE_FAMILIES[borderTintBareBaseName] ?? resolveHueAngle(borderTintHue);
  const borderTintBareAngle = applyWarmthBias(borderTintBareBaseName, borderTintBareRawAngle, warmthBias);
  const borderTintBareBase: ResolvedHueSlot = {
    angle: borderTintBareAngle,
    name: closestHueName(borderTintBareAngle),
    ref: borderTintBareBaseName,
    primaryName: borderTintBareBaseName,
  };

  // borderStrong: borderTint shifted -5° for contrast distinction.
  const borderTintRawAngle = resolveHueAngle(borderTintHue);
  const borderStrongRawAngle = (borderTintRawAngle - 5 + 360) % 360;
  const borderStrongAngle = applyWarmthBias(borderTintHue, borderStrongRawAngle, warmthBias);
  const borderStrong = slotFromAngle(borderStrongAngle);

  return {
    atm,
    txt,
    canvas,
    cardFrame,
    borderTint,
    interactive,
    active,
    accent,
    destructive,
    success,
    caution,
    agent,
    data,
    surfBareBase,
    surfScreen,
    fgMuted,
    fgSubtle,
    fgDisabled,
    fgInverse,
    fgPlaceholder,
    selectionInactive,
    borderTintBareBase,
    borderStrong,
  };
}

// ---------------------------------------------------------------------------
// MoodKnobs — normalized mood knob values (Spec S04)
// ---------------------------------------------------------------------------

/**
 * Normalized mood knob values passed to computeTones() and rule expressions.
 * All fields are 0-100 integers matching the ThemeRecipe optional fields.
 * Spec S04.
 */
export interface MoodKnobs {
  /** Surface contrast knob (0-100, default 50). */
  surfaceContrast: number;
  /** Signal intensity knob (0-100, default 50). */
  signalIntensity: number;
  /** Warmth knob (0-100, default 50). Included for completeness; warmth bias is
   *  applied in resolveHueSlots(), not in computeTones(). */
  warmth: number;
}

// ---------------------------------------------------------------------------
// ComputedTones — pre-computed tone values for rule evaluation (Spec S03)
// ---------------------------------------------------------------------------

/**
 * All derived tone values, pre-computed from DerivationFormulas + MoodKnobs before
 * the rule evaluation loop. Rules reference `computed.*` rather than
 * re-deriving inline, preventing redundant computation and ensuring
 * consistency across all tokens that share the same derived tone.
 *
 * This is Layer 2 output of the three-layer derivation pipeline (Spec S01).
 * Produced by computeTones(); consumed by the rule evaluator.
 *
 * Spec S03.
 */
export interface ComputedTones {
  // Surface tones (derived from preset tone anchors + surfaceContrast)
  bgApp: number;
  bgCanvas: number;
  surfaceSunken: number;
  surfaceDefault: number;
  surfaceRaised: number;
  surfaceOverlay: number;
  surfaceInset: number;
  surfaceContent: number;
  surfaceScreen: number;
  // Divider tones
  dividerDefault: number;
  dividerMuted: number;
  /** Shared reference tone for disabled/toggle/separator tokens (= dividerDefault). */
  dividerTone: number;
  // Control/field derived tones
  disabledBgTone: number;
  disabledFgTone: number;
  disabledBorderTone: number;
  outlinedBgRestTone: number;
  outlinedBgHoverTone: number;
  outlinedBgActiveTone: number;
  toggleTrackOffTone: number;
  toggleDisabledTone: number;
  // Signal intensity (derived from signalIntensity knob)
  signalI: number;
}

// ---------------------------------------------------------------------------
// computeTones — Layer 2: preset + knobs -> ComputedTones (Spec S03)
// ---------------------------------------------------------------------------

/**
 * Pre-compute all derived tone values from a DerivationFormulas and MoodKnobs.
 *
 * This is Layer 2 of the three-layer derivation pipeline (Spec S01).
 * Called by deriveTheme() as Layer 2 of the pipeline. The output ComputedTones
 * is referenced by rule expressions in the RULES table (Layer 3).
 *
 * All formulas are verified against Brio dark-mode ground truth by T-TONES-DARK.
 *
 * Mode-branching is eliminated: computed-tone override fields on formulas use the
 * `number | null` convention — a number means "use this flat value", null means
 * "derive from the formula". [D04] Spec S03.
 *
 * @param formulas - Recipe formula constants (DerivationFormulas)
 * @param knobs    - Normalized mood knob values
 */
export function computeTones(formulas: DerivationFormulas, knobs: MoodKnobs): ComputedTones {
  const sc = knobs.surfaceContrast;

  // ---------------------------------------------------------------------------
  // Surface tones — each anchored at formulas tone at sc=50, scaled around it.
  // ---------------------------------------------------------------------------

  // bg-app: anchored at formulas.bgAppTone at sc=50, ±8 units at extremes
  const bgApp = formulas.bgAppTone + ((sc - 50) / 50) * 8;

  // bg-canvas: unified formula using formulas fields (Spec S03)
  //   Dark: bgCanvasToneBase=bgAppTone, bgCanvasToneSCCenter=50, bgCanvasToneScale=8
  //         -> Math.round(bgAppTone + ((sc - 50)/50) * 8) = Math.round(bgApp)
  //   Light: bgCanvasToneBase=35, bgCanvasToneSCCenter=0, bgCanvasToneScale=10
  //          -> Math.round(35 + (sc/100) * 10)
  const bgCanvas = Math.round(
    formulas.bgCanvasToneBase +
      ((sc - formulas.bgCanvasToneSCCenter) /
        (formulas.bgCanvasToneSCCenter === 0 ? 100 : 50)) *
        formulas.bgCanvasToneScale,
  );

  // surface-sunken: anchored at formulas.surfaceSunkenTone at sc=50, ±5 units
  const surfaceSunken = Math.round(formulas.surfaceSunkenTone + ((sc - 50) / 50) * 5);

  // surface-default: anchored at formulas.surfaceDefaultTone at sc=50, ±3 units
  const surfaceDefault = Math.round(formulas.surfaceDefaultTone + ((sc - 50) / 50) * 3);

  // surface-raised: anchored at formulas.surfaceRaisedTone at sc=50, ±5 units
  const surfaceRaised = Math.round(formulas.surfaceRaisedTone + ((sc - 50) / 50) * 5);

  // surface-overlay: anchored at formulas.surfaceOverlayTone at sc=50, ±5 units
  const surfaceOverlay = Math.round(formulas.surfaceOverlayTone + ((sc - 50) / 50) * 5);

  // surface-inset: anchored at formulas.surfaceInsetTone at sc=50, ±7 units
  const surfaceInset = Math.round(formulas.surfaceInsetTone + ((sc - 50) / 50) * 7);

  // surface-content: matches inset (code blocks, inline content areas)
  const surfaceContent = surfaceInset;

  // surface-screen: anchored at formulas.surfaceScreenTone at sc=50, ±13 units
  const surfaceScreen = Math.round(formulas.surfaceScreenTone + ((sc - 50) / 50) * 13);

  // ---------------------------------------------------------------------------
  // Divider tones — override fields per Spec S03 [D04]
  // number = flat value; null = derive from surfaceOverlay formula.
  // ---------------------------------------------------------------------------
  const dividerDefault = formulas.dividerDefaultToneOverride ??
    Math.round(surfaceOverlay - 2);
  const dividerMuted = formulas.dividerMutedToneOverride ??
    Math.round(surfaceOverlay);
  const dividerTone = dividerDefault;

  // ---------------------------------------------------------------------------
  // Control/field derived tones — override fields per Spec S03 [D04]
  // ---------------------------------------------------------------------------

  // disabled-bg: uses formulas fields (unchanged from before)
  const disabledBgTone = Math.round(
    formulas.disabledBgBase + (sc / 100) * formulas.disabledBgScale,
  );

  // disabled-fg: flat value from formulas.disabledFgToneValue [D04]
  const disabledFgTone = formulas.disabledFgToneValue;

  // disabled-border: number = flat; null = Math.round(dividerTone) [D04]
  const disabledBorderTone = formulas.disabledBorderToneOverride ??
    Math.round(dividerTone);

  // outlined bg tones — number = flat; null = derived [D04]
  const outlinedBgRestTone = formulas.outlinedBgRestToneOverride ??
    Math.round(surfaceInset + 2);
  const outlinedBgHoverTone = formulas.outlinedBgHoverToneOverride ??
    Math.round(surfaceRaised + 1);
  const outlinedBgActiveTone = formulas.outlinedBgActiveToneOverride ??
    Math.round(surfaceOverlay);

  // toggle track off and disabled tones — number = flat; null = derived [D04]
  const toggleTrackOffTone = formulas.toggleTrackOffToneOverride ??
    Math.round(dividerTone);
  const toggleDisabledTone = formulas.toggleDisabledToneOverride ??
    Math.round(surfaceOverlay);

  // Signal intensity: direct mapping from knob (0→0, 50→50, 100→100)
  const signalI = Math.round(knobs.signalIntensity);

  return {
    bgApp: Math.round(bgApp),
    bgCanvas,
    surfaceSunken,
    surfaceDefault,
    surfaceRaised,
    surfaceOverlay,
    surfaceInset,
    surfaceContent,
    surfaceScreen,
    dividerDefault,
    dividerMuted,
    dividerTone,
    disabledBgTone,
    disabledFgTone,
    disabledBorderTone,
    outlinedBgRestTone,
    outlinedBgHoverTone,
    outlinedBgActiveTone,
    toggleTrackOffTone,
    toggleDisabledTone,
    signalI,
  };
}

// ---------------------------------------------------------------------------
// DerivationRule — type union for the rule table (Spec S04)
// ---------------------------------------------------------------------------

/**
 * Shared expression type: a function of (formulas, knobs, computed) -> number.
 * Used for intensity, tone, and alpha fields in chromatic rules. Spec S05.
 */
export type Expr = (formulas: DerivationFormulas, knobs: MoodKnobs, computed: ComputedTones) => number;

/**
 * Chromatic rule — produces a `--tug-color(hue, i, t [,a])` token.
 *
 * hueSlot resolution follows dual-path per [D09]:
 *   1. Direct key: if hueSlot is a key in ResolvedHueSlots, use it directly.
 *   2. Preset-mediated: otherwise read preset[hueSlot + "HueSlot"] for the key.
 * Sentinel values per [D07]: "__white" | "__highlight" | "__shadow" | "__verboseHighlight"
 * trigger non-chromatic dispatch and bypass intensity/tone expressions.
 */
export interface ChromaticRule {
  type: "chromatic";
  hueSlot: string;
  intensityExpr: Expr;
  toneExpr: Expr;
  alphaExpr?: Expr;
}

/** White rule — unconditionally opaque white; no mode branching, no alpha. */
export interface WhiteRule {
  type: "white";
}

/** Shadow rule — black-based semi-transparent token. */
export interface ShadowRule {
  type: "shadow";
  alphaExpr: Expr;
}

/** Highlight rule — white-based semi-transparent token. */
export interface HighlightRule {
  type: "highlight";
  alphaExpr: Expr;
}

/**
 * Structural rule — escape hatch for composite or non-chromatic token values.
 * resolvedExpr is optional; when present it populates the resolved map entry
 * (used for tokens like shadow-overlay that need OKLCH for contrast checking).
 */
export interface StructuralRule {
  type: "structural";
  valueExpr: (
    formulas: DerivationFormulas,
    knobs: MoodKnobs,
    computed: ComputedTones,
    resolvedSlots: ResolvedHueSlots,
  ) => string;
  resolvedExpr?: (
    formulas: DerivationFormulas,
    knobs: MoodKnobs,
    computed: ComputedTones,
  ) => ResolvedColor;
}

/** Invariant rule — static string value that never changes across themes. */
export interface InvariantRule {
  type: "invariant";
  value: string;
}

/** Union of all rule types. Spec S04. */
export type DerivationRule =
  | ChromaticRule
  | WhiteRule
  | ShadowRule
  | HighlightRule
  | StructuralRule
  | InvariantRule;

// ---------------------------------------------------------------------------
// enforceContrastFloor — binary search in tone space (Spec S03)
// ---------------------------------------------------------------------------

/**
 * Compute the contrast between an element at the given tone and a surface
 * at the given OKLab L, using the same formula as computePerceptualContrast
 * but operating directly on L values (no hex round-trip).
 */
function contrastFromLValues(elementL: number, surfaceL: number): number {
  const deltaL = surfaceL - elementL;
  if (Math.abs(deltaL) < CONTRAST_MIN_DELTA) return 0;
  return deltaL > 0
    ? deltaL * CONTRAST_SCALE
    : deltaL * CONTRAST_SCALE * POLARITY_FACTOR;
}

/**
 * Binary-search in tone space (0–100) for the minimum element tone that
 * produces |contrast| >= threshold against a surface at surfaceL.
 *
 * The polarity parameter determines search direction:
 *   "lighter" — element must be lighter than surface (negative polarity pairs).
 *               Search pushes tone toward 100.
 *   "darker"  — element must be darker than surface (positive polarity pairs).
 *               Search pushes tone toward 0.
 *
 * The conversion from tone to OKLab L uses toneToL(tone, elementHueName),
 * which is the same piecewise formula used by resolveOklch(). This avoids
 * a hex round-trip; the binary search result is a tone value that the
 * derivation engine can pass directly to setChromatic().
 *
 * Returns the adjusted tone if clamping was needed, or elementTone if it
 * already passes.
 *
 * @param elementTone   - Current tone value (0–100)
 * @param surfaceL      - Surface OKLab L from resolved map
 * @param threshold     - Required contrast magnitude (e.g. 75 for body-text)
 * @param polarity      - Direction to search ("lighter" | "darker")
 * @param elementHueName - Primary hue name for toneToL conversion
 */
export function enforceContrastFloor(
  elementTone: number,
  surfaceL: number,
  threshold: number,
  polarity: "lighter" | "darker",
  elementHueName: string,
): number {
  const currentL = toneToL(elementTone, elementHueName);
  const currentContrast = contrastFromLValues(currentL, surfaceL);
  if (Math.abs(currentContrast) >= threshold) return elementTone; // already passing

  // Binary search for the minimum clamped tone that passes the threshold.
  // We search in the direction that increases contrast magnitude:
  //   "lighter" polarity: element needs to be lighter (higher tone) than surface
  //   "darker"  polarity: element needs to be darker  (lower tone) than surface
  const lo = polarity === "lighter" ? elementTone : 0;
  const hi = polarity === "lighter" ? 100 : elementTone;

  // Check if the extreme value already fails — if so, return the extreme
  // (we cannot satisfy the threshold; accept the best achievable tone).
  const extremeTone = polarity === "lighter" ? 100 : 0;
  const extremeL = toneToL(extremeTone, elementHueName);
  const extremeContrast = contrastFromLValues(extremeL, surfaceL);
  if (Math.abs(extremeContrast) < threshold) {
    // Threshold unachievable in tone space — return the extreme tone as the
    // best available option. The reconciliation test will catch this case.
    return extremeTone;
  }

  // Binary search over integer tone values.
  let low = lo;
  let high = hi;
  let result = extremeTone;

  // Add a small tone margin to compensate for toneToL approximation vs
  // hex-path OKLab L (see Spec S03 reconciliation note).
  const TONE_MARGIN = 2;

  for (let iter = 0; iter < 20; iter++) {
    const mid = Math.round((low + high) / 2);
    if (mid === low || mid === high) break;

    const midL = toneToL(mid, elementHueName);
    const midContrast = contrastFromLValues(midL, surfaceL);

    if (Math.abs(midContrast) >= threshold) {
      result = mid;
      // For "lighter" polarity: smallest passing tone is toward `lo` — search left
      // For "darker"  polarity: largest passing tone is toward `hi` — search right
      if (polarity === "lighter") {
        high = mid;
      } else {
        low = mid;
      }
    } else {
      if (polarity === "lighter") {
        low = mid;
      } else {
        high = mid;
      }
    }
  }

  // Apply tone margin to avoid rounding-at-hex-quantization misses.
  if (polarity === "lighter") {
    return Math.min(100, result + TONE_MARGIN);
  } else {
    return Math.max(0, result - TONE_MARGIN);
  }
}

/**
 * Build a lookup map from element token name to its pairing entries.
 * Used by evaluateRules to quickly look up surface pairings for a token.
 */
function buildElementPairingLookup(
  pairingMap: ElementSurfacePairing[],
): Map<string, ElementSurfacePairing[]> {
  const lookup = new Map<string, ElementSurfacePairing[]>();
  for (const entry of pairingMap) {
    const existing = lookup.get(entry.element) ?? [];
    existing.push(entry);
    lookup.set(entry.element, existing);
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// evaluateRules — Layer 3: iterate rule table and emit tokens (Spec S01)
// ---------------------------------------------------------------------------

/**
 * Evaluate a named rule table, emitting token strings and resolved OKLCH
 * entries into the provided maps.
 *
 * This is Layer 3 of the three-layer derivation pipeline (Spec S01).
 *
 * hueSlot resolution per [D09]:
 *   1. If hueSlot is a key of resolvedSlots → use it directly.
 *   2. Otherwise read formulas[hueSlot + "HueSlot"] to get the key (formulas-mediated).
 * Sentinel dispatch per [D07]:
 *   "__white"            → setChromatic-style white; fills resolved.
 *   "__highlight"        → compact white-a token; fills resolved.
 *   "__shadow"           → compact black-a token; fills resolved.
 *   "__verboseHighlight" → verbose white form with explicit i:0 t:100; fills resolved.
 *
 * @param rules            Named rule table (token name → DerivationRule)
 * @param resolvedSlots    Output of resolveHueSlots()
 * @param formulas         Active DerivationFormulas for this recipe
 * @param knobs            Normalized mood knobs
 * @param computed         Output of computeTones()
 * @param tokens           Output map for CSS token strings (mutated in place)
 * @param resolved         Output map for OKLCH resolved colors (mutated in place)
 * @param makeShadow       Internal helper: build compact black-a string
 * @param makeHighlight    Internal helper: build compact white-a string
 * @param makeVerboseHighlight Internal helper: build verbose white-i0-t100-a string
 * @param blackResolved    Resolved OKLCH for black
 * @param whiteResolved    Resolved OKLCH for white
 * @param elementPairingLookup  Map from element token name to its pairing entries (for contrast floors)
 * @param diagnostics      Output array for ContrastDiagnostic entries (mutated in place)
 */
export function evaluateRules(
  rules: Record<string, DerivationRule>,
  resolvedSlots: ResolvedHueSlots,
  formulas: DerivationFormulas,
  knobs: MoodKnobs,
  computed: ComputedTones,
  tokens: Record<string, string>,
  resolved: Record<string, ResolvedColor>,
  makeShadow: (alpha: number) => string,
  makeHighlight: (alpha: number) => string,
  makeVerboseHighlight: (alpha: number) => string,
  blackResolved: ResolvedColor,
  whiteResolved: ResolvedColor,
  setChromatic: (
    name: string,
    hueRef: string,
    hueAngle: number,
    i: number,
    t: number,
    a: number,
    hueName: string,
  ) => void,
  elementPairingLookup: Map<string, ElementSurfacePairing[]> = new Map(),
  diagnostics: ContrastDiagnostic[] = [],
): void {
  const slotKeys = new Set(Object.keys(resolvedSlots));

  for (const [tokenName, rule] of Object.entries(rules)) {
    switch (rule.type) {
      case "invariant":
        tokens[tokenName] = rule.value;
        break;

      case "white":
        tokens[tokenName] = "--tug-color(white)";
        resolved[tokenName] = { ...whiteResolved };
        break;

      case "shadow": {
        const alpha = Math.round(rule.alphaExpr(formulas, knobs, computed));
        tokens[tokenName] = makeShadow(alpha);
        resolved[tokenName] = { ...blackResolved, alpha: alpha / 100 };
        break;
      }

      case "highlight": {
        const alpha = Math.round(rule.alphaExpr(formulas, knobs, computed));
        tokens[tokenName] = makeHighlight(alpha);
        resolved[tokenName] = { ...whiteResolved, alpha: alpha / 100 };
        break;
      }

      case "structural": {
        tokens[tokenName] = rule.valueExpr(formulas, knobs, computed, resolvedSlots);
        if (rule.resolvedExpr) {
          resolved[tokenName] = rule.resolvedExpr(formulas, knobs, computed);
        }
        break;
      }

      case "chromatic": {
        // Resolve the effective slot string via dual path [D09]
        let effectiveSlot: string;
        if (slotKeys.has(rule.hueSlot)) {
          effectiveSlot = rule.hueSlot; // direct key path
        } else {
          // Formulas-mediated path: read formulas[hueSlot + "HueSlot"]
          const formulasKey = (rule.hueSlot + "HueSlot") as keyof DerivationFormulas;
          effectiveSlot = (formulas[formulasKey] as string) ?? rule.hueSlot;
        }

        // Sentinel check [D07]: sentinel tokens are structurally fixed (white/black/alpha)
        // and are not eligible for contrast floor enforcement.
        if (effectiveSlot === "__white") {
          tokens[tokenName] = "--tug-color(white)";
          resolved[tokenName] = { ...whiteResolved };
          break;
        }
        if (effectiveSlot === "__highlight") {
          const alpha = Math.round((rule.alphaExpr ?? (() => 100))(formulas, knobs, computed));
          tokens[tokenName] = makeHighlight(alpha);
          resolved[tokenName] = { ...whiteResolved, alpha: alpha / 100 };
          break;
        }
        if (effectiveSlot === "__shadow") {
          const alpha = Math.round((rule.alphaExpr ?? (() => 100))(formulas, knobs, computed));
          tokens[tokenName] = makeShadow(alpha);
          resolved[tokenName] = { ...blackResolved, alpha: alpha / 100 };
          break;
        }
        if (effectiveSlot === "__verboseHighlight") {
          const alpha = Math.round((rule.alphaExpr ?? (() => 100))(formulas, knobs, computed));
          tokens[tokenName] = makeVerboseHighlight(alpha);
          resolved[tokenName] = { ...whiteResolved, alpha: alpha / 100 };
          break;
        }

        // Chromatic resolution
        const slot = resolvedSlots[effectiveSlot as keyof ResolvedHueSlots];
        if (!slot) break; // unknown slot key — skip
        const i = Math.round(rule.intensityExpr(formulas, knobs, computed));
        let t = Math.round(rule.toneExpr(formulas, knobs, computed));
        const a = rule.alphaExpr ? Math.round(rule.alphaExpr(formulas, knobs, computed)) : 100;

        // Contrast floor enforcement (Spec S03, D04):
        // Only apply to fully-opaque chromatic tokens that have pairing entries.
        // Tokens with alpha < 100 are sentinel-dispatched or composite-dependent —
        // skip them (their contrast is measured after compositing, not directly).
        if (a === 100 && elementPairingLookup.has(tokenName)) {
          const pairings = elementPairingLookup.get(tokenName)!;
          const initialTone = t;
          const pairedSurfaces: string[] = [];
          let mostRestrictiveThreshold = 0;
          let adjustedTone = t;

          for (const pairing of pairings) {
            // Skip pairs with parentSurface — compositing changes the effective L
            if (pairing.parentSurface) continue;

            const surfaceResolved = resolved[pairing.surface];
            if (!surfaceResolved) continue; // surface not yet evaluated — skip

            // Skip surfaces with alpha < 1 (semi-transparent overlays: highlights,
            // shadows, bg-hover/active tints). Their raw L does not represent the
            // actual visual background — contrast is only meaningful after compositing
            // over the parent surface, which evaluateRules cannot compute inline.
            if ((surfaceResolved.alpha ?? 1.0) < 1.0) continue;

            const threshold = CONTRAST_THRESHOLDS[pairing.role] ?? 15;
            const surfaceL = surfaceResolved.L;
            const elementL = toneToL(t, slot.primaryName);

            // Check if contrast is already sufficient
            const currentContrast = contrastFromLValues(elementL, surfaceL);
            if (Math.abs(currentContrast) >= threshold) continue;

            // Determine polarity: which direction does element need to move?
            // If element is lighter than surface: "lighter" polarity (push higher)
            // If element is darker than surface: "darker" polarity (push lower)
            const polarity: "lighter" | "darker" = elementL > surfaceL ? "lighter" : "darker";

            const clampedTone = enforceContrastFloor(
              adjustedTone,
              surfaceL,
              threshold,
              polarity,
              slot.primaryName,
            );

            // Take the most restrictive clamped tone (worst case across all surfaces).
            // For "lighter" polarity, we want the highest required tone.
            // For "darker" polarity, we want the lowest required tone.
            if (polarity === "lighter") {
              if (clampedTone > adjustedTone) {
                adjustedTone = clampedTone;
                mostRestrictiveThreshold = Math.max(mostRestrictiveThreshold, threshold);
                pairedSurfaces.push(pairing.surface);
              }
            } else {
              if (clampedTone < adjustedTone) {
                adjustedTone = clampedTone;
                mostRestrictiveThreshold = Math.max(mostRestrictiveThreshold, threshold);
                pairedSurfaces.push(pairing.surface);
              }
            }
          }

          if (adjustedTone !== initialTone) {
            t = adjustedTone;
            diagnostics.push({
              token: tokenName,
              reason: "floor-applied",
              surfaces: pairedSurfaces,
              initialTone,
              finalTone: t,
              threshold: mostRestrictiveThreshold,
            });
          }
        }

        setChromatic(tokenName, slot.ref, slot.angle, i, t, a, slot.primaryName);
        break;
      }
    }
  }
}

/**
 * Compute OKLCH from hue angle, intensity (0-100), tone (0-100).
 * Uses the same formula as tugColor() in palette-engine.ts.
 *
 * The hueName parameter may be a bare name ("cobalt") or a hyphenated adjacency
 * expression ("indigo-cobalt"). In either case, the primary (first) color name
 * is used for DEFAULT_CANONICAL_L and MAX_CHROMA_FOR_HUE lookups.
 */
function resolveOklch(
  hueAngle: number,
  intensity: number,
  tone: number,
  hueName?: string,
): { L: number; C: number; h: number } {
  const fullName = hueName ?? closestHueName(hueAngle);
  // Extract the primary (dominant) color name from a hyphenated expression
  const name = fullName.split("-")[0] in DEFAULT_CANONICAL_L
    ? fullName.split("-")[0]
    : (fullName in DEFAULT_CANONICAL_L ? fullName : closestHueName(hueAngle).split("-")[0]);
  const canonL = DEFAULT_CANONICAL_L[name] ?? 0.77;
  const maxC = MAX_CHROMA_FOR_HUE[name] ?? 0.135;
  const peakC = maxC * PEAK_C_SCALE;

  const L =
    L_DARK +
    (Math.min(tone, 50) * (canonL - L_DARK)) / 50 +
    (Math.max(tone - 50, 0) * (L_LIGHT - canonL)) / 50;

  const C = (intensity / 100) * peakC;
  return { L, C, h: hueAngle };
}

/**
 * Build a `--tug-color()` string in the most compact valid form.
 *
 * Compact rules (per plan task):
 *   - i=50, t=50, a=100 → `--tug-color(hue)` (canonical, bare)
 *   - Preset match (light/dark/intense/muted) → `--tug-color(hue-preset)`
 *   - Otherwise: `--tug-color(hue, i: N, t: N)` with optional a: N
 *
 * When hueRef contains an offset, presets are never used (presets only apply
 * to bare hue names in postcss-tug-color).
 *
 * [D06] Verbose alpha form: when alpha is non-default (ra !== 100) and i/t are
 * canonical defaults (ri === 50, rt === 50), emit the verbose form
 * `--tug-color(hue, i: 50, t: 50, a: N)` instead of `--tug-color(hue, a: N)`.
 * This matches the CSS ground truth for ~19 tokens including accent-subtle,
 * all tone-N-bg, selection-bg, highlight-N, and control-selected-N/highlighted-N.
 */
function makeTugColor(
  hueRef: string,
  i: number,
  t: number,
  a = 100,
): string {
  const ri = Math.round(i);
  const rt = Math.round(t);
  const ra = Math.round(a);

  // Bare keyword shortcuts: black and white bypass the normal i/t/a parameters.
  // Opaque black/white emit the bare form; semi-transparent emit with a: N only.
  if (hueRef === "black") {
    if (ra === 100) return "--tug-color(black)";
    return `--tug-color(black, a: ${ra})`;
  }
  if (hueRef === "white") {
    if (ra === 100) return "--tug-color(white)";
    return `--tug-color(white, a: ${ra})`;
  }

  // Canonical bare form
  if (ri === 50 && rt === 50 && ra === 100) {
    return `--tug-color(${hueRef})`;
  }

  // Preset suffix: applies to any hue ref (base name or hyphenated adjacency).
  // After migration, hueRefs never contain numeric offsets (+/-digits).
  // Hyphenated adjacency names like "indigo-cobalt" are valid base forms for presets.
  {
    if (ri === 20 && rt === 85 && ra === 100) return `--tug-color(${hueRef}-light)`;
    if (ri === 50 && rt === 20 && ra === 100) return `--tug-color(${hueRef}-dark)`;
    if (ri === 90 && rt === 50 && ra === 100) return `--tug-color(${hueRef}-intense)`;
    // [D06] muted preset: palette-engine defines muted as { intensity: 50, tone: 42 }
    if (ri === 50 && rt === 42 && ra === 100) return `--tug-color(${hueRef}-muted)`;
  }

  // Full parameterized form — omit defaults: i=50, t=50, a=100.
  // [D06] Exception: when alpha is non-default (ra !== 100) AND i/t are both at
  // canonical defaults (ri === 50, rt === 50), emit the verbose form
  // `--tug-color(hue, i: 50, t: 50, a: N)` to match the CSS ground truth.
  // When only one of i/t is non-default, the usual compaction rules apply.
  const isVerboseAlpha = ra !== 100 && ri === 50 && rt === 50;
  const parts: string[] = [];
  if (isVerboseAlpha || ri !== 50) parts.push(`i: ${ri}`);
  if (isVerboseAlpha || rt !== 50) parts.push(`t: ${rt}`);
  if (ra !== 100) parts.push(`a: ${ra}`);

  if (parts.length === 0) {
    return `--tug-color(${hueRef})`;
  }
  return `--tug-color(${hueRef}, ${parts.join(", ")})`;
}

/** Achromatic black token string — bare keyword form per plan task [D01]. */
const BLACK_TOKEN = "--tug-color(black)";
/** Achromatic white token string — bare keyword form per plan task [D01]. */
const WHITE_TOKEN = "--tug-color(white)";

/** Resolved OKLCH for black (special-case per plan). */
const BLACK_RESOLVED: ResolvedColor = { L: 0, C: 0, h: 0, alpha: 1 };
/** Resolved OKLCH for white (special-case per plan). */
const WHITE_RESOLVED: ResolvedColor = { L: 1, C: 0, h: 0, alpha: 1 };

/**
 * Build a semi-transparent black token (shadow / overlay).
 * alpha is 0-100.
 * Emits verbose form with explicit i: 0, t: 0 to match the CSS ground truth.
 */
function makeShadowToken(alpha: number): string {
  return `--tug-color(black, i: 0, t: 0, a: ${Math.round(alpha)})`;
}

/**
 * Build a semi-transparent white token (highlight / overlay).
 * alpha is 0-100.
 */
function makeHighlightToken(alpha: number): string {
  return `--tug-color(white, a: ${Math.round(alpha)})`;
}

/**
 * Build a verbose white highlight token (i: 0, t: 100 explicit) for tokens
 * that must match the CSS ground truth verbose form per [D06].
 * alpha is 0-100.
 */
function makeVerboseHighlightToken(alpha: number): string {
  return `--tug-color(white, i: 0, t: 100, a: ${Math.round(alpha)})`;
}

/**
 * Build a resolved entry for a fully opaque chromatic token.
 */
function resolvedEntry(
  hueAngle: number,
  intensity: number,
  tone: number,
  hueName?: string,
): ResolvedColor {
  const { L, C, h } = resolveOklch(hueAngle, intensity, tone, hueName);
  return { L, C, h, alpha: 1 };
}

/**
 * Build a resolved entry for a semi-transparent chromatic token.
 */
function resolvedEntryAlpha(
  hueAngle: number,
  intensity: number,
  tone: number,
  alpha: number,
  hueName?: string,
): ResolvedColor {
  const { L, C, h } = resolveOklch(hueAngle, intensity, tone, hueName);
  return { L, C, h, alpha: alpha / 100 };
}

// ---------------------------------------------------------------------------
// deriveTheme — main entry point
// ---------------------------------------------------------------------------

/**
 * Derive a complete `--tug-base-*` theme from a `ThemeRecipe`.
 *
 * Returns `ThemeOutput` with:
 *   - `tokens`: every `--tug-base-*` token as a `--tug-color()` string or
 *     invariant value (for export / display)
 *   - `resolved`: OKLCH values for all chromatic tokens (for contrast checking
 *     and CVD simulation); structural and invariant tokens are absent [D09]
 *   - `contrastResults` / `cvdWarnings`: empty arrays (populated in later steps)
 *
 * Three-layer declarative pipeline (Spec S01):
 *   Layer 1 — resolveHueSlots(): recipe + warmth    -> ResolvedHueSlots
 *   Layer 2 — computeTones():    formulas + knobs   -> ComputedTones
 *   Layer 3 — evaluateRules():   RULES table        -> tokens + resolved maps
 */
export function deriveTheme(recipe: ThemeRecipe): ThemeOutput {
  // -------------------------------------------------------------------------
  // 1. Resolve formula constants [D01]
  // recipe.formulas when provided, else Dark recipe default. [D02]
  // Silent fallback: the only production recipe is the Dark recipe.
  // -------------------------------------------------------------------------
  const formulas: DerivationFormulas = recipe.formulas ?? DARK_FORMULAS;

  // -------------------------------------------------------------------------
  // 2. Mood knob normalization (0-100, default 50)
  // -------------------------------------------------------------------------
  const surfaceContrast = recipe.surfaceContrast ?? 50;
  const signalIntensity = recipe.signalIntensity ?? 50;
  const warmth = recipe.warmth ?? 50;
  const knobs: MoodKnobs = { surfaceContrast, signalIntensity, warmth };

  // -------------------------------------------------------------------------
  // 3. Layer 1 — resolve all hue slots (Spec S02)
  // -------------------------------------------------------------------------
  const resolvedSlots = resolveHueSlots(recipe, warmth, formulas);

  // -------------------------------------------------------------------------
  // 4. Layer 2 — pre-compute derived tone values (Spec S03)
  // -------------------------------------------------------------------------
  const computedTones = computeTones(formulas, knobs);
  const tokens: Record<string, string> = {};
  const resolved: Record<string, ResolvedColor> = {};

  // =========================================================================
  // 5. Layer 3 — evaluate rule table to produce all tokens
  // =========================================================================

  // Build element pairing lookup for contrast floor enforcement (D04).
  // Surfaces must be evaluated before foreground tokens — guaranteed by RULES
  // table ordering (SURFACE_RULES precedes FG_RULES and CONTROL_RULES).
  const elementPairingLookup = buildElementPairingLookup(ELEMENT_SURFACE_PAIRING_MAP);
  const diagnostics: ContrastDiagnostic[] = [];

  evaluateRules(
    RULES,
    resolvedSlots,
    formulas,
    knobs,
    computedTones,
    tokens,
    resolved,
    makeShadowToken,
    makeHighlightToken,
    makeVerboseHighlightToken,
    BLACK_RESOLVED,
    WHITE_RESOLVED,
    (name, hueRef, hueAngle, i, t, a, hueName) => {
      tokens[name] = makeTugColor(hueRef, i, t, a);
      if (a === 100) {
        resolved[name] = resolvedEntry(hueAngle, i, t, hueName);
      } else if (hueRef === "black" || (i === 0 && t === 0)) {
        resolved[name] = { ...BLACK_RESOLVED, alpha: a / 100 };
      } else if (hueRef === "white" || (i === 0 && t === 100)) {
        resolved[name] = { ...WHITE_RESOLVED, alpha: a / 100 };
      } else {
        resolved[name] = resolvedEntryAlpha(hueAngle, i, t, a, hueName);
      }
    },
    elementPairingLookup,
    diagnostics,
  );

  // =========================================================================
  // Return ThemeOutput
  // =========================================================================
  return {
    name: recipe.name,
    mode: recipe.mode,
    tokens,
    resolved,
    contrastResults: [],
    cvdWarnings: [],
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Utility: isValidSRGBColor — gamut check for resolved colors
// ---------------------------------------------------------------------------

/**
 * Check whether a resolved color is within the sRGB gamut.
 * Used by tests (T2.6) to verify non-overridden token reasonableness.
 */
export function isValidSRGBResolvedColor(color: ResolvedColor): boolean {
  return isInSRGBGamut(color.L, color.C, color.h);
}

// ---------------------------------------------------------------------------
// generateResolvedCssExport — resolved oklch() CSS for saved themes
// ---------------------------------------------------------------------------

/**
 * Compute a simple djb2-style hash of a string for the recipe hash header.
 * Not cryptographic — used only as a human-readable fingerprint in comments.
 */
function simpleHashForEngine(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Generate a resolved oklch() CSS export string for a derived theme.
 *
 * Produces a complete CSS file using raw oklch() values instead of
 * --tug-color() notation, suitable for saving themes to disk and loading
 * them at runtime without the PostCSS plugin. [D03] Resolved oklch() CSS.
 *
 * - Header comment with @theme-name, @theme-description, date, recipe hash
 * - `body { }` block with all resolved --tug-base-* tokens as oklch() values
 *
 * Exported for unit testing.
 */
export function generateResolvedCssExport(
  output: ThemeOutput,
  recipe: ThemeRecipe,
): string {
  const recipeJson = JSON.stringify(recipe);
  const hash = simpleHashForEngine(recipeJson);
  const dateStr = new Date().toISOString().slice(0, 10);

  const header = [
    "/**",
    ` * @theme-name ${recipe.name}`,
    ` * @theme-description ${recipe.description}`,
    ` * @generated ${dateStr}`,
    ` * @recipe-hash ${hash}`,
    " *",
    " * Generated by Theme Generator. Contains --tug-base-* overrides as resolved oklch() values.",
    " * Spacing, radius, typography, stroke, icon-size are theme-invariant and not overridden.",
    " */",
  ].join("\n");

  const entries = Object.entries(output.resolved).map(([name, color]) => {
    const { L, C, h, alpha } = color;
    const value =
      alpha < 1
        ? `oklch(${L} ${C} ${h} / ${alpha})`
        : `oklch(${L} ${C} ${h})`;
    return `  ${name}: ${value};`;
  });

  const body = ["body {", ...entries, "}"].join("\n");

  return `${header}\n${body}\n`;
}
