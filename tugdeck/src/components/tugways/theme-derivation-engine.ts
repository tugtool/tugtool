/**
 * Theme Derivation Engine — Tugways Theme Generator
 *
 * Derives complete 373-token `--tug-base-*` themes from a compact `ThemeRecipe`.
 * Each call to `deriveTheme()` returns:
 *   - `tokens`: all 373 token values as `--tug-color()` strings (for CSS export)
 *   - `resolved`: OKLCH values for all chromatic tokens (for contrast checking / CVD)
 *
 * The derivation uses a four-step pipeline:
 *   Step 0 — compileRecipe(): RecipeParameters → DerivationFormulas
 *             Interpolates 7 design parameters (0-100) against curated endpoint
 *             bundles to produce a complete DerivationFormulas. Skipped when
 *             recipe.formulas is provided directly (escape hatch). [D06]
 *   Layer 1 — resolveHueSlots(): recipe → ResolvedHueSlots
 *             Resolves all per-tier hue variants (fg-muted, surfBareBase, etc.)
 *             using palette angles verbatim — no warmth bias applied.
 *   Layer 2 — computeTones(): DerivationFormulas + MoodKnobs → ComputedTones
 *             Pre-computes all derived tone values. surfaceContrast is fixed at 50
 *             (scaling neutralized by compiled formulas); signalIntensity is derived
 *             from formulas.signalIntensityValue. [D04]
 *   Layer 3 — evaluateRules(): RULES table → tokens + resolved maps
 *             Iterates the declarative rule table in derivation-rules.ts, calling
 *             the appropriate helper for each token type.
 *
 * Mode differences (dark vs light) are expressed entirely as data in
 * DARK_FORMULAS / LIGHT_FORMULAS and the RULES table —
 * deriveTheme() itself contains no mode branching.
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
 *                          Fields: surfaceAppTone, surfaceCanvasTone
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
 *                          Fields: atmosphereIntensity, surfaceAppIntensity, surfaceCanvasIntensity, surfaceDefaultIntensity,
 *                                  surfaceRaisedIntensity, surfaceOverlayIntensity, surfaceScreenIntensity,
 *                                  surfaceInsetIntensity, surfaceContentIntensity, surfaceAppBaseIntensity
 *
 * text-brightness          How bright primary and inverse text is.
 *                          Fields: contentTextTone, inverseTextTone
 *
 * text-hierarchy           How much secondary/tertiary text dims from primary. The
 *                          tone spread across muted, subtle, disabled, and
 *                          placeholder tiers.
 *                          Fields: mutedTextTone, subtleTextTone, disabledTextTone,
 *                                  placeholderTextTone
 *
 * text-coloring            How much chroma text carries. Controls saturation for
 *                          primary, subtle, muted, inverse, and on-surface text.
 *                          Fields: contentTextIntensity, subtleTextIntensity, mutedTextIntensity, atmosphereBorderIntensity,
 *                                  inverseTextIntensity, onCautionTextIntensity, onSuccessTextIntensity
 *
 * border-visibility        How visible borders and dividers are. Controls tone and
 *                          intensity for default, muted, strong borders and dividers.
 *                          Fields: borderBaseIntensity, borderStrongIntensity, borderMutedTone,
 *                                  borderMutedIntensity, borderStrongTone, dividerDefaultIntensity,
 *                                  dividerMutedIntensity
 *
 * card-frame-style         How card title bars and tab bars present. Controls the
 *                          tone and intensity of active and inactive card frames.
 *                          Fields: cardFrameActiveIntensity, cardFrameActiveTone,
 *                                  cardFrameInactiveIntensity, cardFrameInactiveTone
 *
 * shadow-depth             How pronounced shadows and overlay tints are. Controls
 *                          alpha values for all shadow sizes and overlay layers.
 *                          Fields: shadowXsAlpha, shadowMdAlpha, shadowLgAlpha,
 *                                  shadowXlAlpha, shadowOverlayAlpha, overlayDimAlpha,
 *                                  overlayScrimAlpha, overlayHighlightAlpha
 *
 * filled-control-prominence How bold filled buttons are. Controls the tone of the
 *                          filled button background at rest, hover, and press.
 *                          Fields: filledSurfaceRestTone, filledSurfaceHoverTone,
 *                                  filledSurfaceActiveTone
 *
 * outlined-control-style   How outlined buttons present across states and modes.
 *                          Controls fg/icon tone and intensity, option border tones,
 *                          hover/active background intensity and alpha.
 *                          Fields: outlinedTextRestTone, outlinedTextHoverTone,
 *                                  outlinedTextActiveTone, outlinedTextIntensity,
 *                                  outlinedIconRestTone, outlinedIconHoverTone,
 *                                  outlinedIconActiveTone, outlinedIconIntensity,
 *                                  outlinedTextRestToneLight, outlinedTextHoverToneLight,
 *                                  outlinedTextActiveToneLight,
 *                                  outlinedIconRestToneLight,
 *                                  outlinedIconHoverToneLight,
 *                                  outlinedIconActiveToneLight,
 *                                  outlinedOptionBorderRestTone,
 *                                  outlinedOptionBorderHoverTone,
 *                                  outlinedOptionBorderActiveTone,
 *                                  outlinedSurfaceHoverIntensity, outlinedSurfaceHoverAlpha,
 *                                  outlinedSurfaceActiveIntensity, outlinedSurfaceActiveAlpha
 *
 * ghost-control-style      How ghost buttons present across states and modes.
 *                          Controls fg/icon/border tone and intensity for action
 *                          and option roles.
 *                          Fields: ghostTextRestTone, ghostTextHoverTone,
 *                                  ghostTextActiveTone, ghostTextRestIntensity, ghostTextHoverIntensity,
 *                                  ghostTextActiveIntensity, ghostIconRestTone,
 *                                  ghostIconHoverTone, ghostIconActiveTone,
 *                                  ghostIconRestIntensity, ghostIconHoverIntensity, ghostIconActiveIntensity,
 *                                  ghostBorderIntensity, ghostBorderTone,
 *                                  ghostTextRestToneLight, ghostTextHoverToneLight,
 *                                  ghostTextActiveToneLight, ghostTextRestIntensityLight,
 *                                  ghostTextHoverIntensityLight, ghostTextActiveIntensityLight,
 *                                  ghostIconRestToneLight, ghostIconHoverToneLight,
 *                                  ghostIconActiveToneLight, ghostIconActiveIntensityLight
 *
 * badge-style              How tinted badges present. Controls fg/bg/border tone,
 *                          intensity, and alpha for the tinted badge variant.
 *                          Fields: badgeTintedTextIntensity, badgeTintedTextTone,
 *                                  badgeTintedSurfaceIntensity, badgeTintedSurfaceTone,
 *                                  badgeTintedSurfaceAlpha, badgeTintedBorderIntensity,
 *                                  badgeTintedBorderTone, badgeTintedBorderAlpha
 *
 * icon-style               How icons present in non-control contexts. Controls
 *                          tone and intensity for active and muted icon tiers.
 *                          Fields: iconActiveTone, iconMutedIntensity, iconMutedTone
 *
 * tab-style                How tabs present. Controls the active tab foreground
 *                          tone.
 *                          Fields: tabTextActiveTone
 *
 * toggle-style             How toggles present. Controls hover/disabled tones and
 *                          intensity for the toggle track and thumb.
 *                          Fields: toggleTrackOnHoverTone, toggleThumbDisabledTone,
 *                                  toggleTrackDisabledIntensity
 *
 * field-style              How form fields present. Controls tone anchors and
 *                          intensity for field backgrounds and borders across all
 *                          states, plus disabled control parameters.
 *                          Fields: fieldSurfaceRestTone, fieldSurfaceHoverTone,
 *                                  fieldSurfaceFocusTone, fieldSurfaceDisabledTone,
 *                                  fieldSurfaceReadOnlyTone, fieldSurfaceRestIntensity,
 *                                  disabledSurfaceIntensity, disabledBorderIntensity
 *
 * hue-slot-dispatch        Which hue slot each surface, foreground, icon, border,
 *                          disabled, field, and toggle tier reads from. These are
 *                          string keys into ResolvedHueSlots that determine what
 *                          hue family each token uses.
 *                          Fields: surfaceAppHueSlot, surfaceCanvasHueSlot,
 *                                  surfaceSunkenHueSlot, surfaceDefaultHueSlot,
 *                                  surfaceRaisedHueSlot, surfaceOverlayHueSlot,
 *                                  surfaceInsetHueSlot, surfaceContentHueSlot,
 *                                  surfaceScreenHueSlot, mutedTextHueSlot,
 *                                  subtleTextHueSlot, disabledTextHueSlot,
 *                                  placeholderTextHueSlot, inverseTextHueSlot,
 *                                  onAccentTextHueSlot, iconMutedHueSlot,
 *                                  iconOnAccentHueSlot, dividerMutedHueSlot,
 *                                  disabledSurfaceHueSlot, fieldSurfaceHoverHueSlot,
 *                                  fieldSurfaceReadOnlyHueSlot, fieldPlaceholderHueSlot,
 *                                  fieldBorderRestHueSlot, fieldBorderHoverHueSlot,
 *                                  toggleTrackDisabledHueSlot, toggleThumbHueSlot,
 *                                  checkmarkHueSlot, radioDotHueSlot,
 *                                  tabSurfaceActiveHueSlot, tabSurfaceInactiveHueSlot
 *
 * sentinel-hue-dispatch    Which sentinel hue slot hover/active interactive
 *                          backgrounds use (__highlight, __verboseHighlight, etc.).
 *                          Fields: outlinedSurfaceHoverHueSlot, outlinedSurfaceActiveHueSlot,
 *                                  ghostActionSurfaceHoverHueSlot,
 *                                  ghostActionSurfaceActiveHueSlot,
 *                                  ghostOptionSurfaceHoverHueSlot,
 *                                  ghostOptionSurfaceActiveHueSlot,
 *                                  tabSurfaceHoverHueSlot, tabCloseSurfaceHoverHueSlot,
 *                                  highlightHoverHueSlot
 *
 * sentinel-alpha           Alpha values for sentinel-dispatched hover/active
 *                          interactive tokens. Determines how opaque the tinted
 *                          hover/press overlay appears.
 *                          Fields: tabSurfaceHoverAlpha, tabCloseSurfaceHoverAlpha,
 *                                  ghostActionSurfaceHoverAlpha,
 *                                  ghostActionSurfaceActiveAlpha,
 *                                  ghostOptionSurfaceHoverAlpha,
 *                                  ghostOptionSurfaceActiveAlpha, highlightHoverAlpha,
 *                                  ghostDangerSurfaceHoverAlpha, ghostDangerSurfaceActiveAlpha
 *
 * computed-tone-override   Flat-value overrides for tones that otherwise derive
 *                          from formulas, plus formula parameters for canvas and
 *                          disabled-bg tone computations.
 *                          Fields: dividerDefaultToneOverride,
 *                                  dividerMutedToneOverride, disabledTextToneComputed,
 *                                  disabledBorderToneOverride,
 *                                  outlinedSurfaceRestToneOverride,
 *                                  outlinedSurfaceHoverToneOverride,
 *                                  outlinedSurfaceActiveToneOverride,
 *                                  toggleTrackOffToneOverride,
 *                                  toggleDisabledToneOverride,
 *                                  surfaceCanvasToneBase, surfaceCanvasToneCenter,
 *                                  surfaceCanvasToneScale, disabledSurfaceToneBase,
 *                                  disabledSurfaceToneScale, borderStrongToneComputed
 *
 * hue-name-dispatch        Named hue values used in resolveHueSlots() to eliminate
 *                          runtime mode branches. These string fields directly name
 *                          the hue family for derived slots (surfScreen, fgMuted,
 *                          fgSubtle, etc.).
 *                          Fields: surfaceScreenHueExpression, mutedTextHueExpression, subtleTextHueExpression,
 *                                  disabledTextHueExpression, inverseTextHueExpression, placeholderTextHueExpression,
 *                                  selectionInactiveHueExpression
 *
 * selection-mode           Selection behavior mode flags and parameters. Controls
 *                          how the inactive selection background is resolved and
 *                          how prominent it appears.
 *                          Fields: selectionInactiveSemanticMode,
 *                                  selectionSurfaceInactiveIntensity, selectionSurfaceInactiveTone,
 *                                  selectionSurfaceInactiveAlpha
 *
 * @module components/tugways/theme-derivation-engine
 */

import { DARK_FORMULAS, LIGHT_FORMULAS } from "./formula-constants";
import { type RecipeControls, RECIPE_REGISTRY, defaultDarkControls } from "./recipe-functions";

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
  type RecipeParameters,
  defaultParameters,
  compileRecipe,
} from "./recipe-parameters";
import {
  toneToL,
  CONTRAST_SCALE,
  POLARITY_FACTOR,
  CONTRAST_MIN_DELTA,
  CONTRAST_THRESHOLDS,
  compositeOverSurface,
  hexToOkLabL,
} from "./theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "./element-surface-pairing-map";
import type { ElementSurfacePairing } from "./element-surface-pairing-map";

// ---------------------------------------------------------------------------
// Public interfaces — Spec S01 / S02
// ---------------------------------------------------------------------------

/**
 * Compact recipe input — nested surface/element/role groups. Spec S01.
 *
 * Surface group: hues for background planes.
 * Element group: hues for foreground elements (text, icons, borders).
 *   - `cardFrame` is derived from `element.border` (same hue, formulas control tone/intensity)
 *   - `link`/`interactive` hue is derived from `role.action` directly
 * Role group: vivid semantic signal hues.
 */
export interface ThemeRecipe {
  name: string;
  /** Human-readable description of the design intent for this theme. */
  description: string;
  mode: "dark" | "light";

  surface: {
    /** Hue for bg-canvas and bg-app backgrounds. */
    canvas: string;
    /** Hue for card surfaces (atmosphere hue). */
    card: string;
  };

  element: {
    /** Hue for primary prose/body text. Contrast role: content (75). */
    content: string;
    /** Hue for interactive element labels (buttons, tabs, menus). Contrast role: control (60). */
    control: string;
    /** Hue for titles, headers, card titles. Contrast role: display (60). */
    display: string;
    /** Hue for muted/metadata/placeholder text. Contrast role: informational (60). */
    informational: string;
    /** Hue for borders and dividers. cardFrame is derived from this hue. */
    border: string;
    /** Hue for non-text ornamental marks. Contrast role: decorative (15). */
    decorative: string;
  };

  role: {
    /** Vivid accent hue (orange by default). */
    accent: string;
    /** Action/active/interactive hue — also drives link/interactive hue. */
    action: string;
    /** Agent role hue. */
    agent: string;
    /** Data visualization hue. */
    data: string;
    /** Success/positive signal hue. */
    success: string;
    /** Caution/warning signal hue. */
    caution: string;
    /** Danger/destructive signal hue. */
    danger: string;
  };

  /** Seven design parameters (0-100). Compiled by compileRecipe() to produce DerivationFormulas. */
  parameters?: RecipeParameters;
  /** All formula constants for this recipe. Takes precedence over parameters when provided. [D06] */
  formulas?: DerivationFormulas;
  /**
   * Recipe control values. When provided, looked up in RECIPE_REGISTRY[recipe.mode]
   * and the registered recipe function is called with these controls to produce
   * DerivationFormulas. Takes precedence over parameters but not over formulas. (Spec S04)
   */
  controls?: RecipeControls;
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
  role: "content" | "control" | "display" | "informational" | "decorative";
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
 *   "floor-applied"            — tone was clamped by enforceContrastFloor against an opaque surface (pass 1)
 *   "floor-applied-composited" — tone was clamped by enforceContrastFloor against a composited surface L (pass 2)
 *   "structurally-fixed"       — token is black/white/transparent/alpha; not adjustable
 *   "composite-dependent"      — token uses parentSurface compositing; floor not applied
 */
export interface ContrastDiagnostic {
  token: string;
  reason: "floor-applied" | "floor-applied-composited" | "structurally-fixed" | "composite-dependent";
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
 * A single resolved hue slot. Hue angle is the raw palette angle — no bias applied.
 * Produced by resolveHueSlots(). Spec S02.
 */
export interface ResolvedHueSlot {
  /** Hue angle in degrees. Raw palette angle, used verbatim. */
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
 *   - Element hues (control, display, informational, decorative) — derived from element group
 *   - Semantic hues (destructive, success, caution, agent, data) — vivid signal hues
 *   - Per-tier derived hues (surfBareBase, surfScreen, fgMuted, fgSubtle, fgDisabled,
 *     fgInverse, fgPlaceholder, selectionInactive, borderTintBareBase, borderStrong)
 */
export interface ResolvedHueSlots {
  // Recipe hues
  atm: ResolvedHueSlot;         // atmosphere (surface.card hue)
  txt: ResolvedHueSlot;         // content text hue (element.content)
  canvas: ResolvedHueSlot;      // canvas hue (bg-app, bg-canvas)
  cardFrame: ResolvedHueSlot;   // card title bar hue (derived from element.border)
  borderTint: ResolvedHueSlot;  // border/divider tint hue (element.border)
  interactive: ResolvedHueSlot; // link/selection hue — derived from role.action [D05]
  active: ResolvedHueSlot;      // active state hue (role.action)
  accent: ResolvedHueSlot;      // accent hue (role.accent)
  // Element hues — new semantic slots for foreground element types
  control: ResolvedHueSlot;       // interactive element label hue (element.control)
  display: ResolvedHueSlot;       // title/header hue (element.display)
  informational: ResolvedHueSlot; // muted/metadata/placeholder hue (element.informational)
  decorative: ResolvedHueSlot;    // non-text ornamental hue (element.decorative)
  // Semantic hues (vivid signal hues)
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
  surfaceAppTone: number;
  /** @semantic canvas-darkness — tone of the canvas (page-level) background */
  surfaceCanvasTone: number;

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
  atmosphereIntensity: number;
  /** @semantic surface-coloring — chroma intensity for the app background surface */
  surfaceAppIntensity: number;
  /** @semantic surface-coloring — chroma intensity for the canvas background */
  surfaceCanvasIntensity: number;
  /** @semantic surface-coloring — chroma intensity for the default card surface */
  surfaceDefaultIntensity: number;
  /** @semantic surface-coloring — chroma intensity for raised surfaces */
  surfaceRaisedIntensity: number;
  /** @semantic surface-coloring — chroma intensity for overlay surfaces */
  surfaceOverlayIntensity: number;
  /** @semantic surface-coloring — chroma intensity for screen surfaces */
  surfaceScreenIntensity: number;
  /** @semantic surface-coloring — chroma intensity for inset surfaces */
  surfaceInsetIntensity: number;
  /** @semantic surface-coloring — chroma intensity for content surfaces */
  surfaceContentIntensity: number;
  /**
   * @semantic surface-coloring — bg-app intensity unified field.
   * Dark: surfaceAppIntensity (2). Light: atmosphereIntensity.
   */
  surfaceAppBaseIntensity: number;

  // ===== Text Brightness =====
  // How bright primary and inverse text is. Dark: near 100. Light: near 0.
  /** @semantic text-brightness — tone of primary body text */
  contentTextTone: number;
  /** @semantic text-brightness — tone of inverse (on-filled) text */
  inverseTextTone: number;

  // ===== Text Hierarchy =====
  // How much secondary/tertiary text dims from primary. Dark: descending from 94. Light: ascending from 8.
  /** @semantic text-hierarchy — tone of muted (secondary) text */
  mutedTextTone: number;
  /** @semantic text-hierarchy — tone of subtle (tertiary) text */
  subtleTextTone: number;
  /** @semantic text-hierarchy — tone of disabled text */
  disabledTextTone: number;
  /** @semantic text-hierarchy — tone of placeholder text */
  placeholderTextTone: number;

  // ===== Text Coloring =====
  // How much chroma text carries. Dark: I 2-7. Light: I 3-8.
  /** @semantic text-coloring — chroma intensity for primary text */
  contentTextIntensity: number;
  /** @semantic text-coloring — chroma intensity for subtle text tiers */
  subtleTextIntensity: number;
  /** @semantic text-coloring — chroma intensity for muted text */
  mutedTextIntensity: number;
  /** @semantic text-coloring — chroma intensity for atmosphere-hued border tiers */
  atmosphereBorderIntensity: number;
  /** @semantic text-coloring — chroma intensity for inverse (on-filled) text */
  inverseTextIntensity: number;
  /** @semantic text-coloring — chroma intensity for text on caution surfaces */
  onCautionTextIntensity: number;
  /** @semantic text-coloring — chroma intensity for text on success surfaces */
  onSuccessTextIntensity: number;

  // ===== Border Visibility =====
  // How visible borders and dividers are. Dark: subtle I 4-7. Light: crisp I 6-10.
  /** @semantic border-visibility — base chroma intensity for default borders */
  borderBaseIntensity: number;
  /** @semantic border-visibility — chroma intensity for strong/emphasis borders */
  borderStrongIntensity: number;
  /** @semantic border-visibility — tone of muted (de-emphasized) borders */
  borderMutedTone: number;
  /** @semantic border-visibility — chroma intensity for muted borders */
  borderMutedIntensity: number;
  /** @semantic border-visibility — tone of strong (high-contrast) borders */
  borderStrongTone: number;
  /** @semantic border-visibility — chroma intensity for default divider lines */
  dividerDefaultIntensity: number;
  /** @semantic border-visibility — chroma intensity for muted divider lines */
  dividerMutedIntensity: number;
  /** @semantic signal-tone — tone for role-colored signal borders (borderRamp). Dark: 50. Light: lower to avoid neon glow. */
  borderSignalTone: number;
  /** @semantic signal-tone — tone for semantic tone tokens (semanticTone). Dark: 50. Light: lower to avoid neon glow. */
  semanticSignalTone: number;
  /**
   * @semantic signal-tone — tone for the accent-subtle tinted background.
   * Dark: lower tone (e.g. 30) so fg-default achieves content contrast 75 when composited
   * over a dark parent surface at low alpha. Light: 50 (standard mid-tone orange tint).
   * [phase-3-bug B04] calibrated from 50→30 in dark mode.
   */
  accentSubtleTone: number;
  /**
   * @semantic signal-tone — tone for the tone-caution-bg semantic background tint.
   * Dark: lower tone (e.g. 30) so fg-default achieves content contrast 75 when composited
   * over a dark parent surface at low alpha. Light: matches semanticSignalTone (35).
   * [phase-3-bug B05] calibrated via independent tone field rather than alpha reduction.
   */
  cautionSurfaceTone: number;

  // ===== Card Frame Style =====
  // How card title bars and tab bars present. Dark: dim tones 15-18. Light: bright tones 85-92.
  /** @semantic card-frame-style — chroma intensity for the active card title bar */
  cardFrameActiveIntensity: number;
  /** @semantic card-frame-style — tone of the active card title bar */
  cardFrameActiveTone: number;
  /** @semantic card-frame-style — chroma intensity for inactive card title bars */
  cardFrameInactiveIntensity: number;
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
  filledSurfaceRestTone: number;
  /** @semantic filled-control-prominence — tone of the filled button background on hover */
  filledSurfaceHoverTone: number;
  /** @semantic filled-control-prominence — tone of the filled button background on press */
  filledSurfaceActiveTone: number;

  // ===== Outlined Control Style =====
  // How outlined buttons present across states/modes. Dark: white fg. Light: dark fg.
  /** @semantic outlined-control-style — tone of outlined button foreground text at rest */
  outlinedTextRestTone: number;
  /** @semantic outlined-control-style — tone of outlined button foreground text on hover */
  outlinedTextHoverTone: number;
  /** @semantic outlined-control-style — tone of outlined button foreground text on press */
  outlinedTextActiveTone: number;
  /** @semantic outlined-control-style — chroma intensity for outlined button foreground text */
  outlinedTextIntensity: number;
  /** @semantic outlined-control-style — tone of outlined button icons at rest */
  outlinedIconRestTone: number;
  /** @semantic outlined-control-style — tone of outlined button icons on hover */
  outlinedIconHoverTone: number;
  /** @semantic outlined-control-style — tone of outlined button icons on press */
  outlinedIconActiveTone: number;
  /** @semantic outlined-control-style — chroma intensity for outlined button icons */
  outlinedIconIntensity: number;
  /** @semantic outlined-control-style — light-mode tone of outlined button foreground text at rest */
  outlinedTextRestToneLight: number;
  /** @semantic outlined-control-style — light-mode tone of outlined button foreground text on hover */
  outlinedTextHoverToneLight: number;
  /** @semantic outlined-control-style — light-mode tone of outlined button foreground text on press */
  outlinedTextActiveToneLight: number;
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
  outlinedSurfaceHoverIntensity: number;
  /**
   * @semantic outlined-control-style — outlined bg-hover alpha unified field.
   */
  outlinedSurfaceHoverAlpha: number;
  /**
   * @semantic outlined-control-style — outlined bg-active intensity unified field.
   * Dark: 0 (highlight sentinel). Light: 6.
   */
  outlinedSurfaceActiveIntensity: number;
  /**
   * @semantic outlined-control-style — outlined bg-active alpha unified field.
   */
  outlinedSurfaceActiveAlpha: number;

  // ===== Ghost Control Style =====
  // How ghost buttons present across states/modes. Dark: white fg. Light: dark fg.
  /** @semantic ghost-control-style — tone of ghost button foreground text at rest */
  ghostTextRestTone: number;
  /** @semantic ghost-control-style — tone of ghost button foreground text on hover */
  ghostTextHoverTone: number;
  /** @semantic ghost-control-style — tone of ghost button foreground text on press */
  ghostTextActiveTone: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button foreground text at rest */
  ghostTextRestIntensity: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button foreground text on hover */
  ghostTextHoverIntensity: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button foreground text on press */
  ghostTextActiveIntensity: number;
  /** @semantic ghost-control-style — tone of ghost button icons at rest */
  ghostIconRestTone: number;
  /** @semantic ghost-control-style — tone of ghost button icons on hover */
  ghostIconHoverTone: number;
  /** @semantic ghost-control-style — tone of ghost button icons on press */
  ghostIconActiveTone: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button icons at rest */
  ghostIconRestIntensity: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button icons on hover */
  ghostIconHoverIntensity: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button icons on press */
  ghostIconActiveIntensity: number;
  /** @semantic ghost-control-style — chroma intensity for ghost button borders */
  ghostBorderIntensity: number;
  /** @semantic ghost-control-style — tone of ghost button borders */
  ghostBorderTone: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button foreground text at rest */
  ghostTextRestToneLight: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button foreground text on hover */
  ghostTextHoverToneLight: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button foreground text on press */
  ghostTextActiveToneLight: number;
  /** @semantic ghost-control-style — light-mode chroma intensity for ghost button foreground text at rest */
  ghostTextRestIntensityLight: number;
  /** @semantic ghost-control-style — light-mode chroma intensity for ghost button foreground text on hover */
  ghostTextHoverIntensityLight: number;
  /** @semantic ghost-control-style — light-mode chroma intensity for ghost button foreground text on press */
  ghostTextActiveIntensityLight: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button icons at rest */
  ghostIconRestToneLight: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button icons on hover */
  ghostIconHoverToneLight: number;
  /** @semantic ghost-control-style — light-mode tone of ghost button icons on press */
  ghostIconActiveToneLight: number;
  /** @semantic ghost-control-style — light-mode chroma intensity for ghost button icons on press */
  ghostIconActiveIntensityLight: number;

  // ===== Badge Style =====
  // How tinted badges present. Dark: bright fg on tinted bg. Light: dark fg on tinted bg.
  /** @semantic badge-style — chroma intensity for tinted badge foreground text */
  badgeTintedTextIntensity: number;
  /** @semantic badge-style — tone of tinted badge foreground text */
  badgeTintedTextTone: number;
  /** @semantic badge-style — chroma intensity for tinted badge background */
  badgeTintedSurfaceIntensity: number;
  /** @semantic badge-style — tone of tinted badge background */
  badgeTintedSurfaceTone: number;
  /** @semantic badge-style — alpha of tinted badge background */
  badgeTintedSurfaceAlpha: number;
  /** @semantic badge-style — chroma intensity for tinted badge border */
  badgeTintedBorderIntensity: number;
  /** @semantic badge-style — tone of tinted badge border */
  badgeTintedBorderTone: number;
  /** @semantic badge-style — alpha of tinted badge border */
  badgeTintedBorderAlpha: number;

  // ===== Icon Style =====
  // How icons present in non-control contexts. Dark: bright tones. Light: dark tones.
  /** @semantic icon-style — tone of active/interactive icons */
  iconActiveTone: number;
  /** @semantic icon-style — chroma intensity for muted icons */
  iconMutedIntensity: number;
  /** @semantic icon-style — tone of muted icons */
  iconMutedTone: number;

  // ===== Tab Style =====
  // How tabs present. Dark: bright active fg. Light: dark active fg.
  /** @semantic tab-style — tone of foreground text/icons on the active tab */
  tabTextActiveTone: number;

  // ===== Toggle Style =====
  // How toggles present. Dark: bright thumb. Light: dark track.
  /** @semantic toggle-style — tone of the toggle track background on hover (on-state) */
  toggleTrackOnHoverTone: number;
  /** @semantic toggle-style — tone of the toggle thumb when disabled */
  toggleThumbDisabledTone: number;
  /** @semantic toggle-style — chroma intensity for the disabled toggle track */
  toggleTrackDisabledIntensity: number;

  // ===== Field Style =====
  // How form fields present. Dark: dark bg tones. Light: light bg tones.
  /** @semantic field-style — tone of the field background at rest */
  fieldSurfaceRestTone: number;
  /** @semantic field-style — tone of the field background on hover */
  fieldSurfaceHoverTone: number;
  /** @semantic field-style — tone of the field background when focused */
  fieldSurfaceFocusTone: number;
  /** @semantic field-style — tone of the field background when disabled */
  fieldSurfaceDisabledTone: number;
  /** @semantic field-style — tone of the field background in read-only state */
  fieldSurfaceReadOnlyTone: number;
  /** @semantic field-style — chroma intensity for the resting field background */
  fieldSurfaceRestIntensity: number;
  /** @semantic field-style — chroma intensity for disabled control backgrounds */
  disabledSurfaceIntensity: number;
  /** @semantic field-style — chroma intensity for disabled control borders */
  disabledBorderIntensity: number;

  // ===== Hue Slot Dispatch =====
  // Which hue slot each surface/fg/icon/border tier reads from. String keys into ResolvedHueSlots.
  /** @semantic hue-slot-dispatch — hue slot for the app background surface */
  surfaceAppHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for the canvas background */
  surfaceCanvasHueSlot: string;
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
  mutedTextHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for subtle (tertiary) foreground text */
  subtleTextHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for disabled foreground text */
  disabledTextHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for placeholder foreground text */
  placeholderTextHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for inverse (on-filled) foreground text */
  inverseTextHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for foreground text on accent-filled surfaces */
  onAccentTextHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for muted icons */
  iconMutedHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for icons on accent-filled surfaces */
  iconOnAccentHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for muted divider lines */
  dividerMutedHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for disabled control backgrounds */
  disabledSurfaceHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for the field background on hover */
  fieldSurfaceHoverHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for read-only field backgrounds */
  fieldSurfaceReadOnlyHueSlot: string;
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
  tabSurfaceActiveHueSlot: string;
  /** @semantic hue-slot-dispatch — hue slot for inactive tab bar backgrounds */
  tabSurfaceInactiveHueSlot: string;

  // ===== Sentinel Hue Dispatch =====
  // Which sentinel hue slot hover/active backgrounds use. String keys (__highlight, __verboseHighlight, etc.).
  /** @semantic sentinel-hue-dispatch — hue slot for outlined control hover background */
  outlinedSurfaceHoverHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for outlined control active background */
  outlinedSurfaceActiveHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for ghost action button hover background */
  ghostActionSurfaceHoverHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for ghost action button active background */
  ghostActionSurfaceActiveHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for ghost option button hover background */
  ghostOptionSurfaceHoverHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for ghost option button active background */
  ghostOptionSurfaceActiveHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for tab hover background */
  tabSurfaceHoverHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for tab close button hover background */
  tabCloseSurfaceHoverHueSlot: string;
  /** @semantic sentinel-hue-dispatch — hue slot for inline highlight hover tint */
  highlightHoverHueSlot: string;

  // ===== Sentinel Alpha =====
  // Alpha values for sentinel-dispatched hover/active tokens. Percentage values 5-20.
  /** @semantic sentinel-alpha — alpha for tab background on hover */
  tabSurfaceHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for tab close button background on hover */
  tabCloseSurfaceHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for outlined control hover background */
  /** @semantic sentinel-alpha — alpha for outlined control active background */
  /** @semantic sentinel-alpha — alpha for ghost action button hover background */
  ghostActionSurfaceHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for ghost action button active background */
  ghostActionSurfaceActiveAlpha: number;
  /** @semantic sentinel-alpha — alpha for ghost option button hover background */
  ghostOptionSurfaceHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for ghost option button active background */
  ghostOptionSurfaceActiveAlpha: number;
  /** @semantic sentinel-alpha — alpha for inline highlight hover tint */
  highlightHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for ghost danger button hover background */
  ghostDangerSurfaceHoverAlpha: number;
  /** @semantic sentinel-alpha — alpha for ghost danger button active background */
  ghostDangerSurfaceActiveAlpha: number;

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
   * Always a number (dark: 38; future light uses disabledTextTone).
   */
  disabledTextToneComputed: number;
  /**
   * @semantic computed-tone-override — flat tone for disabled-border.
   * null = Math.round(dividerTone). Dark: 28.
   */
  disabledBorderToneOverride: number | null;
  /**
   * @semantic computed-tone-override — flat tone for outlined-bg-rest.
   * null = Math.round(surfaceInset + 2). Dark: null (derives from formula).
   */
  outlinedSurfaceRestToneOverride: number | null;
  /**
   * @semantic computed-tone-override — flat tone for outlined-bg-hover.
   * null = Math.round(surfaceRaised + 1). Dark: null (derives from formula).
   */
  outlinedSurfaceHoverToneOverride: number | null;
  /**
   * @semantic computed-tone-override — flat tone for outlined-bg-active.
   * null = Math.round(surfaceOverlay). Dark: null (derives from formula).
   */
  outlinedSurfaceActiveToneOverride: number | null;
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
  surfaceCanvasToneBase: number;
  /** @semantic computed-tone-override — surfaceContrast midpoint for canvas tone formula */
  surfaceCanvasToneCenter: number;
  /** @semantic computed-tone-override — scale factor for canvas tone formula */
  surfaceCanvasToneScale: number;
  /** @semantic computed-tone-override — base tone for disabled-bg formula */
  disabledSurfaceToneBase: number;
  /** @semantic computed-tone-override — scale factor for disabled-bg formula */
  disabledSurfaceToneScale: number;
  /**
   * @semantic computed-tone-override — border-strong tone unified field.
   * Dark: subtleTextTone (37).
   */
  borderStrongToneComputed: number;

  // ===== Hue Name Dispatch =====
  // Named hue values for resolveHueSlots() branch elimination. String hue names.
  /**
   * @semantic hue-name-dispatch — hue name for the surfScreen derived slot.
   * Dark: "indigo".
   */
  surfaceScreenHueExpression: string;
  /**
   * @semantic hue-name-dispatch — expression for the fgMuted derived slot hue.
   * "__bare_primary" = use the bare primary segment of txtHue (e.g. "cobalt" from "indigo-cobalt").
   * Any other value = treat as a literal hue name.
   */
  mutedTextHueExpression: string;
  /**
   * @semantic hue-name-dispatch — hue name for the fgSubtle derived slot.
   * Dark: "indigo-cobalt".
   */
  subtleTextHueExpression: string;
  /**
   * @semantic hue-name-dispatch — hue name for the fgDisabled derived slot.
   * Dark: "indigo-cobalt".
   */
  disabledTextHueExpression: string;
  /**
   * @semantic hue-name-dispatch — hue name for the fgInverse derived slot.
   * Dark: "sapphire-cobalt".
   */
  inverseTextHueExpression: string;
  /**
   * @semantic hue-name-dispatch — source for the fgPlaceholder derived slot.
   * "fgMuted" = copy from fgMuted slot.
   * "atm"     = copy from atm slot.
   */
  placeholderTextHueExpression: string;
  /**
   * @semantic hue-name-dispatch — hue name for the selectionInactive derived slot.
   * Used only when selectionInactiveSemanticMode is true.
   * Dark: "yellow".
   */
  selectionInactiveHueExpression: string;

  // ===== Selection Mode =====
  // Selection behavior mode flags and parameters. Mode-specific boolean + numeric.
  /**
   * @semantic selection-mode — selectionInactive resolution mode flag.
   * When true: use named hue from selectionInactiveHueExpression directly.
   * When false: compute atm offset (atmBaseAngle - 20°) verbatim.
   * Dark: true.
   */
  selectionInactiveSemanticMode: boolean;
  /**
   * @semantic selection-mode — selection-bg-inactive chroma intensity.
   * Dark: 0. Light: 8.
   */
  selectionSurfaceInactiveIntensity: number;
  /**
   * @semantic selection-mode — selection-bg-inactive tone.
   * Dark: 30. Light: 24.
   */
  selectionSurfaceInactiveTone: number;
  /**
   * @semantic selection-mode — selection-bg-inactive alpha.
   * Dark: 25. Light: 20.
   */
  selectionSurfaceInactiveAlpha: number;

  // ===== Signal Intensity Value =====
  // Compiled signal intensity for computeTones() derivation.
  /**
   * @semantic signal-tone — compiled signal intensity value (0-100).
   * Interpolated by P6: Signal Strength. Read by computeTones() to populate
   * computed.signalIntensity. Replaces the MoodKnobs.signalIntensity passthrough.
   * Dark reference: 50. Light reference: 50.
   */
  signalIntensityValue: number;
}

// ---------------------------------------------------------------------------
// EXAMPLE_RECIPES — built-in theme recipes
// ---------------------------------------------------------------------------

/**
 * Built-in theme recipes. Keys become preset button labels in the Theme
 * Generator card. The first entry (brio) is the default dark theme;
 * harmony is the built-in light peer.
 *
 * Both use the nested surface/element/role structure from Phase 3.5B [D03][D04].
 * Brio uses the recipe function path via controls: defaultDarkControls. [D01]
 * Harmony still uses the legacy parameter system (updated to recipe functions in Step 2).
 */
export const EXAMPLE_RECIPES: Record<string, ThemeRecipe> = {
  brio: {
    name: "brio",
    description: "Deep, immersive dark theme. Very dark surfaces with subtle layering. Near-white text with wide hierarchy spread. Filled controls are prominent with vivid accent backgrounds and white text. Borders are subtle. Shadows are moderate. Industrial warmth with muted chassis and vivid signals.",
    mode: "dark",
    surface: {
      canvas: "indigo-violet", // bg-canvas, bg-app
      card: "indigo-violet",   // card surfaces (atmosphere hue)
    },
    element: {
      content: "cobalt",         // primary prose/body text
      control: "cobalt",         // interactive element labels (matches content by default)
      display: "indigo",         // titles/headers — indigo at 260°, +10° warmer than cobalt at 250°
      informational: "indigo-violet", // muted/metadata text — matches canvas hue
      border: "indigo-violet",   // borders and dividers; cardFrame derived from this
      decorative: "gray",        // non-text ornamental marks — near-neutral
    },
    role: {
      accent: "orange",
      action: "blue",            // link/interactive hue is derived from this
      agent: "violet",
      data: "teal",
      success: "green",
      caution: "yellow",
      danger: "red",
    },
    // Use recipe function path — darkRecipe(defaultDarkControls) produces DerivationFormulas. [D01]
    controls: defaultDarkControls,
    parameters: defaultParameters(),
  },
  harmony: {
    name: "harmony",
    description: "Bright, open canvas with crisp surfaces. Dark text for maximum readability with clear hierarchy. Filled controls use vivid accent backgrounds with white text. Borders are crisp and visible. Shadows are light. Industrial warmth with muted chassis and vivid signals — the same palette as Brio, seen in daylight.",
    mode: "light",
    surface: {
      canvas: "indigo-violet", // same palette as brio — light near-white canvas
      card: "indigo-violet",   // same palette as brio
    },
    element: {
      content: "cobalt",         // same palette as brio
      control: "cobalt",         // same palette as brio
      display: "indigo",         // same palette as brio — indigo title bars
      informational: "indigo-violet", // same palette as brio
      border: "indigo-violet",   // same palette as brio — crisp indigo-violet borders
      decorative: "gray",        // same palette as brio
    },
    role: {
      accent: "orange",
      action: "blue",            // same palette as brio
      agent: "violet",
      data: "teal",
      success: "green",
      caution: "yellow",
      danger: "red",
    },
    parameters: defaultParameters(),
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
// Hue name helpers — module scope
// ---------------------------------------------------------------------------

/**
 * Extract the primary base color name from a hue expression.
 * "cobalt" -> "cobalt", "indigo-cobalt" -> "indigo", "indigo-violet" -> "indigo".
 */
export function primaryColorName(hueExpr: string): string {
  const hyphenIdx = hueExpr.indexOf("-");
  return hyphenIdx > 0 ? hueExpr.slice(0, hyphenIdx) : hueExpr;
}

// ---------------------------------------------------------------------------
// resolveHueSlots — Layer 1: recipe -> ResolvedHueSlots (Spec S02)
// ---------------------------------------------------------------------------

/**
 * Resolve all hue slots for a recipe, deriving all per-tier hues.
 * Hue angles from the palette are used verbatim — no warmth bias applied.
 *
 * This is Layer 1 of the three-layer derivation pipeline (Spec S01).
 * The output `ResolvedHueSlots` is the canonical source for all hue angles
 * and refs used in token derivation.
 *
 * Recipe field mapping (nested structure from Phase 3.5B):
 *   - atm         ← recipe.surface.card
 *   - txt         ← recipe.element.content
 *   - canvas      ← recipe.surface.canvas
 *   - cardFrame   ← derived from recipe.element.border (same hue)
 *   - borderTint  ← recipe.element.border
 *   - interactive ← derived from recipe.role.action (not a separate field)
 *   - active      ← recipe.role.action
 *   - accent      ← recipe.role.accent
 *   - control     ← recipe.element.control (new semantic slot)
 *   - display     ← recipe.element.display (new semantic slot)
 *   - informational ← recipe.element.informational (new semantic slot)
 *   - decorative  ← recipe.element.decorative (new semantic slot)
 *
 * Per-tier derived hue slots (surfScreen, fgMuted, fgSubtle, fgDisabled,
 * fgInverse, fgPlaceholder, selectionInactive) are driven by
 * `formulas` fields when `recipe.formulas` is present, eliminating
 * all runtime mode branches from the formula path. [D03]
 *
 * @param recipe  - The theme recipe
 * @param formulas - Formula constants; defaults to recipe.formulas ?? DARK_FORMULAS
 */
export function resolveHueSlots(
  recipe: ThemeRecipe,
  formulas: DerivationFormulas = recipe.formulas ?? DARK_FORMULAS,
): ResolvedHueSlots {
  /** Build a ResolvedHueSlot from a hue name. Hue angle used verbatim. */
  function resolveSlot(hueName: string): ResolvedHueSlot {
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
  const atmHue = recipe.surface.card;
  const txtHue = recipe.element.content;
  const canvasHue = recipe.surface.canvas;
  // cardFrame is derived from element.border (same hue; formulas control tone/intensity)
  const cardFrameHue = recipe.element.border;
  const borderTintHue = recipe.element.border;
  // interactive/link hue is derived from role.action directly (not a separate recipe field)
  const interactiveHue = recipe.role.action;
  const activeHue = recipe.role.action;
  const accentHue = recipe.role.accent;

  const atm = resolveSlot(atmHue);
  const txt = resolveSlot(txtHue);
  const canvas = resolveSlot(canvasHue);
  const cardFrame = resolveSlot(cardFrameHue);
  const borderTint = resolveSlot(borderTintHue);
  const interactive = resolveSlot(interactiveHue);
  const active = resolveSlot(activeHue);
  const accent = resolveSlot(accentHue);

  // Element hues — new semantic slots for foreground element types
  const control = resolveSlot(recipe.element.control);
  const display = resolveSlot(recipe.element.display);
  const informational = resolveSlot(recipe.element.informational);
  const decorative = resolveSlot(recipe.element.decorative);

  // Semantic hues — vivid signal hues
  const destructive = resolveSlot(recipe.role.danger);
  const success = resolveSlot(recipe.role.success);
  const caution = resolveSlot(recipe.role.caution);
  const agent = resolveSlot(recipe.role.agent);
  const data = resolveSlot(recipe.role.data);

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
  const surfBareBaseAngle = HUE_FAMILIES[atmBareBaseName] ?? resolveHueAngle(atmHue);
  const surfBareBase: ResolvedHueSlot = {
    angle: surfBareBaseAngle,
    name: closestHueName(surfBareBaseAngle),
    ref: atmBareBaseName, // direct named reference (matches existing deriveTheme logic)
    primaryName: atmBareBaseName,
  };

  // surfScreen: driven by formulas.surfaceScreenHueExpression. [D03]
  // When surfaceScreenHueExpression equals txtHue, copy the txt slot (light-mode equivalent);
  // otherwise resolve it as a named hue directly.
  const surfScreen: ResolvedHueSlot = formulas.surfaceScreenHueExpression === txtHue
    ? { ...txt }
    : slotFromAngle(resolveHueAngle(formulas.surfaceScreenHueExpression));

  // fgMuted: driven by formulas.mutedTextHueExpression. [D03]
  // "__bare_primary" → bare primary of txtHue (dark-mode default).
  // Any other value → treat as a literal hue name.
  const fgMutedHueName = formulas.mutedTextHueExpression === "__bare_primary"
    ? (() => {
        const primary = primaryColorName(txtHue);
        return primary in HUE_FAMILIES ? primary : txtHue;
      })()
    : formulas.mutedTextHueExpression;
  const fgMutedAngle = resolveHueAngle(fgMutedHueName);
  const fgMutedName = closestHueName(fgMutedAngle);
  const fgMuted: ResolvedHueSlot = {
    angle: fgMutedAngle,
    name: fgMutedName,
    // ref: use bare name directly when it's a known family (matches existing logic)
    ref: fgMutedHueName in HUE_FAMILIES ? fgMutedHueName : fgMutedName,
    primaryName: primaryColorName(fgMutedName),
  };

  // fgSubtle: driven by formulas.subtleTextHueExpression. [D03]
  const fgSubtleHueName = formulas.subtleTextHueExpression;
  const fgSubtle = slotFromAngle(resolveHueAngle(fgSubtleHueName));

  // fgDisabled: driven by formulas.disabledTextHueExpression. [D03]
  const fgDisabledHueName = formulas.disabledTextHueExpression;
  const fgDisabled = slotFromAngle(resolveHueAngle(fgDisabledHueName));

  // fgInverse: driven by formulas.inverseTextHueExpression. [D03]
  const fgInverseHueName = formulas.inverseTextHueExpression;
  const fgInverse = slotFromAngle(resolveHueAngle(fgInverseHueName));

  // fgPlaceholder: driven by formulas.placeholderTextHueExpression. [D03]
  // "fgMuted" → copy fgMuted slot; "atm" → copy atm slot.
  const fgPlaceholder: ResolvedHueSlot =
    formulas.placeholderTextHueExpression === "atm" ? { ...atm } : { ...fgMuted };

  // selectionInactive: driven by formulas.selectionInactiveSemanticMode. [D03]
  // true  → resolveSlot(selectionInactiveHueExpression) — named hue (dark default)
  // false → compute atm offset: atmBaseAngle - 20° verbatim (light-mode style)
  const selectionInactive: ResolvedHueSlot = formulas.selectionInactiveSemanticMode
    ? resolveSlot(formulas.selectionInactiveHueExpression)
    : (() => {
        const atmBaseAngle = resolveHueAngle(atmHue);
        return slotFromAngle((atmBaseAngle - 20 + 360) % 360);
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
  const borderTintBareAngle = HUE_FAMILIES[borderTintBareBaseName] ?? resolveHueAngle(borderTintHue);
  const borderTintBareBase: ResolvedHueSlot = {
    angle: borderTintBareAngle,
    name: closestHueName(borderTintBareAngle),
    ref: borderTintBareBaseName,
    primaryName: borderTintBareBaseName,
  };

  // borderStrong: borderTint shifted -5° for contrast distinction.
  const borderTintRawAngle = resolveHueAngle(borderTintHue);
  const borderStrong = slotFromAngle((borderTintRawAngle - 5 + 360) % 360);

  return {
    atm,
    txt,
    canvas,
    cardFrame,
    borderTint,
    interactive,
    active,
    accent,
    control,
    display,
    informational,
    decorative,
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
 * surfaceContrast is fixed at 50 — scaling expressions in computeTones() are
 * neutralized by setting scale formula fields to 0 in compiled formulas. [D04]
 * Spec S04.
 */
export interface MoodKnobs {
  /** Surface contrast knob. Fixed at 50 to neutralize computeTones() scaling. */
  surfaceContrast: number;
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
  surfaceApp: number;
  surfaceCanvas: number;
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
  disabledSurfaceTone: number;
  disabledTextTone: number;
  disabledBorderTone: number;
  outlinedSurfaceRestTone: number;
  outlinedSurfaceHoverTone: number;
  outlinedSurfaceActiveTone: number;
  toggleTrackOffTone: number;
  toggleDisabledTone: number;
  // Signal intensity (derived from formulas.signalIntensityValue — P6: Signal Strength) [D04]
  signalIntensity: number;
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
 * surfaceContrast is fixed at 50 in MoodKnobs — scaling expressions are neutralized
 * by compiled formula scale fields set to 0. [D04]
 * signalIntensity on ComputedTones is derived from formulas.signalIntensityValue
 * (interpolated by compileRecipe() from P6: Signal Strength), not from MoodKnobs. [D04]
 *
 * All formulas are verified against Brio dark-mode ground truth by T-TONES-DARK.
 *
 * Mode-branching is eliminated: computed-tone override fields on formulas use the
 * `number | null` convention — a number means "use this flat value", null means
 * "derive from the formula". Spec S03.
 *
 * @param formulas - Recipe formula constants (DerivationFormulas)
 * @param knobs    - Mood knobs (surfaceContrast fixed at 50 in production)
 */
export function computeTones(formulas: DerivationFormulas, knobs: MoodKnobs): ComputedTones {
  const sc = knobs.surfaceContrast;

  // ---------------------------------------------------------------------------
  // Surface tones — each anchored at formulas tone at sc=50, scaled around it.
  // ---------------------------------------------------------------------------

  // bg-app: anchored at formulas.surfaceAppTone at sc=50, ±8 units at extremes
  const surfaceApp = formulas.surfaceAppTone + ((sc - 50) / 50) * 8;

  // bg-canvas: formula parameters from compiled formulas. When compileRecipe() is used,
  // surfaceCanvasToneScale is set to 0 and surfaceCanvasToneCenter to 50, so (sc-50)/50 * 0 = 0
  // and the formula passes through surfaceCanvasToneBase directly. [D04]
  const surfaceCanvas = Math.round(
    formulas.surfaceCanvasToneBase +
      ((sc - formulas.surfaceCanvasToneCenter) /
        (formulas.surfaceCanvasToneCenter === 0 ? 100 : 50)) *
        formulas.surfaceCanvasToneScale,
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
  const disabledSurfaceTone = Math.round(
    formulas.disabledSurfaceToneBase + (sc / 100) * formulas.disabledSurfaceToneScale,
  );

  // disabled-fg: flat value from formulas.disabledTextToneComputed [D04]
  const disabledTextTone = formulas.disabledTextToneComputed;

  // disabled-border: number = flat; null = Math.round(dividerTone) [D04]
  const disabledBorderTone = formulas.disabledBorderToneOverride ??
    Math.round(dividerTone);

  // outlined bg tones — number = flat; null = derived [D04]
  const outlinedSurfaceRestTone = formulas.outlinedSurfaceRestToneOverride ??
    Math.round(surfaceInset + 2);
  const outlinedSurfaceHoverTone = formulas.outlinedSurfaceHoverToneOverride ??
    Math.round(surfaceRaised + 1);
  const outlinedSurfaceActiveTone = formulas.outlinedSurfaceActiveToneOverride ??
    Math.round(surfaceOverlay);

  // toggle track off and disabled tones — number = flat; null = derived [D04]
  const toggleTrackOffTone = formulas.toggleTrackOffToneOverride ??
    Math.round(dividerTone);
  const toggleDisabledTone = formulas.toggleDisabledToneOverride ??
    Math.round(surfaceOverlay);

  // Signal intensity: derived from compiled formula field signalIntensityValue.
  // compileRecipe() interpolates signalIntensityValue from P6: Signal Strength.
  // The 18+ rule expressions in derivation-rules.ts read computed.signalIntensity unchanged. [D04]
  const signalIntensity = Math.round(formulas.signalIntensityValue);

  return {
    surfaceApp: Math.round(surfaceApp),
    surfaceCanvas,
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
    disabledSurfaceTone,
    disabledTextTone,
    disabledBorderTone,
    outlinedSurfaceRestTone,
    outlinedSurfaceHoverTone,
    outlinedSurfaceActiveTone,
    toggleTrackOffTone,
    toggleDisabledTone,
    signalIntensity,
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
 * @param threshold     - Required contrast magnitude (e.g. 75 for content role)
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
/**
 * Deferred entry for pass-2 composited contrast enforcement.
 * Captures all data needed to call enforceContrastFloor and setChromatic
 * atomically after pass 1 has fully resolved all opaque tokens.
 * References: [D01], Spec S02
 */
interface DeferredCompositedEntry {
  tokenName: string;
  slotPrimaryName: string;
  hueRef: string;
  hueAngle: number;
  intensity: number;
  alpha: number;
  pairing: ElementSurfacePairing;
}

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

  // Pass 2 state — populated during pass 1 to enable composited enforcement
  // after all opaque tokens are resolved. [D01], Spec S02
  const deferredCompositedPairings: DeferredCompositedEntry[] = [];
  // finalToneMap: captures the post-pass-1 tone for each chromatic token so
  // pass 2 starts from the pass-1-adjusted tone (not the pre-adjustment value).
  const finalToneMap = new Map<string, number>();

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
            // Pairs with parentSurface need compositing to determine the effective
            // surface L. There are two categories:
            //
            // A) Surface is semi-transparent (alpha < 1.0): must composite over
            //    parentSurface in linear sRGB to get the correct effective L.
            //    Defer to pass 2. [D01], [D04], Spec S02
            //
            // B) Surface is fully opaque (alpha = 1.0): parentSurface annotation
            //    exists for validateThemeContrast (post-hoc audit), but the surface
            //    L is already authoritative and does not change after compositing.
            //    These pairs are design-choice decorative constraints (same-hue
            //    border vs bg) documented in KNOWN_PAIR_EXCEPTIONS — skip entirely
            //    to preserve original pass-1 skip behavior for such pairs.
            if (pairing.parentSurface) {
              const surfaceForCheck = resolved[pairing.surface];
              if (surfaceForCheck && (surfaceForCheck.alpha ?? 1.0) < 1.0) {
                // Category A: semi-transparent surface — defer to pass 2
                deferredCompositedPairings.push({
                  tokenName,
                  slotPrimaryName: slot.primaryName,
                  hueRef: slot.ref,
                  hueAngle: slot.angle,
                  intensity: i,
                  alpha: a,
                  pairing,
                });
              }
              // Category B: fully opaque surface with parentSurface annotation —
              // skip (same as original behavior; pairs are documented exceptions)
              continue;
            }

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

        // Record post-pass-1 tone so pass 2 starts from the adjusted value.
        // Tokens with both opaque and composited pairings need this: pass 1
        // may have pushed tone from e.g. 50 to 60 for an opaque surface, and
        // pass 2 must start from 60. [D01], Spec S02 (critical timing note)
        if (a === 100) {
          finalToneMap.set(tokenName, t);
        }

        setChromatic(tokenName, slot.ref, slot.angle, i, t, a, slot.primaryName);
        break;
      }
    }
  }

  // =========================================================================
  // Pass 2: Composited contrast enforcement [D01], [D04], Spec S02
  //
  // Iterate all deferred (parentSurface) pairings. Each element token's
  // starting tone is read from finalToneMap (post-pass-1 adjusted), so pass 2
  // is strictly additive — it can only push tone further if the composited
  // surface is more restrictive than any opaque surface pass 1 already handled.
  //
  // Compositing path: compositeOverSurface (linear sRGB alpha-blend) then
  // hexToOkLabL — matching exactly how validateThemeContrast measures
  // composited pairs. [D04], Spec S01
  // =========================================================================
  for (const entry of deferredCompositedPairings) {
    const {
      tokenName,
      slotPrimaryName,
      hueRef,
      hueAngle,
      intensity,
      alpha,
      pairing,
    } = entry;

    // Starting tone: use post-pass-1 value from finalToneMap if available,
    // otherwise fall back to the tone baked into the current resolved entry
    // (this handles the rare case where a token has ONLY composited pairings).
    let currentTone = finalToneMap.get(tokenName);
    if (currentTone === undefined) {
      // Token had no opaque pairings — tone from rule expr (no pass-1 change).
      // We can recover it from the resolved map via L, but it is simpler to
      // skip if the resolved entry is not yet set (should not happen since
      // setChromatic was called above for every chromatic token).
      continue;
    }

    const surfaceResolved = resolved[pairing.surface];
    const parentResolved = resolved[pairing.parentSurface!];
    if (!surfaceResolved || !parentResolved) continue; // tokens not yet resolved

    // parentSurface must be fully opaque; compositeOverSurface will throw if not.
    // Skip gracefully in production to avoid crashing on edge cases.
    if ((parentResolved.alpha ?? 1.0) < 1.0) continue;

    // Compute composited surface L via linear sRGB alpha-blending. [D04], Spec S01
    const compositeHex = compositeOverSurface(surfaceResolved, parentResolved);
    const compositeL = hexToOkLabL(compositeHex);

    const elementL = toneToL(currentTone, slotPrimaryName);
    const threshold = CONTRAST_THRESHOLDS[pairing.role] ?? 15;

    // Check if contrast is already sufficient against the composited surface
    const currentContrast = contrastFromLValues(elementL, compositeL);
    if (Math.abs(currentContrast) >= threshold) continue;

    // Polarity based on element vs composited surface L (not raw surfaceL). [D01]
    const polarity: "lighter" | "darker" = elementL > compositeL ? "lighter" : "darker";

    const adjustedTone = enforceContrastFloor(
      currentTone,
      compositeL,
      threshold,
      polarity,
      slotPrimaryName,
    );

    // Only update the token if the adjusted tone actually meets the threshold.
    // enforceContrastFloor returns the extreme tone (0 or 100) when the threshold
    // is structurally unachievable in tone space. In that case we must NOT update
    // the token — the pair is structurally impossible and will be documented in
    // RECIPE_PAIR_EXCEPTIONS or KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.
    const adjustedL = toneToL(adjustedTone, slotPrimaryName);
    const achievedContrast = contrastFromLValues(adjustedL, compositeL);
    if (Math.abs(achievedContrast) < threshold) continue;

    if (adjustedTone !== currentTone) {
      const priorTone = currentTone;

      // Atomically update both tokens[name] (CSS string) and resolved[name]
      // (ResolvedColor) via the same setChromatic callback used in pass 1.
      // Without this call, tokens would encode the pre-pass-2 tone while
      // resolved would be stale. [D01]
      setChromatic(tokenName, hueRef, hueAngle, intensity, adjustedTone, alpha, slotPrimaryName);

      // Update finalToneMap so subsequent deferred entries for the same token
      // see the most restrictive tone. [D01], Spec S02 step 10
      finalToneMap.set(tokenName, adjustedTone);
      currentTone = adjustedTone;

      diagnostics.push({
        token: tokenName,
        reason: "floor-applied-composited",
        surfaces: [pairing.surface],
        initialTone: priorTone,
        finalTone: adjustedTone,
        threshold,
      });
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
 *   Layer 1 — resolveHueSlots(): recipe              -> ResolvedHueSlots
 *   Layer 2 — computeTones():    formulas + knobs   -> ComputedTones
 *   Layer 3 — evaluateRules():   RULES table        -> tokens + resolved maps
 */
export function deriveTheme(recipe: ThemeRecipe): ThemeOutput {
  // -------------------------------------------------------------------------
  // 1. Resolve formula constants [D01] [D06]
  // Precedence (Spec S04):
  //   1. recipe.formulas — use directly (existing escape hatch)
  //   2. recipe.controls + RECIPE_REGISTRY[mode] — call registry function
  //   3. RECIPE_REGISTRY[mode] with defaults — call registry function with defaults
  //   4. compileRecipe fallback (legacy parameter system)
  // -------------------------------------------------------------------------
  let formulas: DerivationFormulas;
  if (recipe.formulas) {
    formulas = recipe.formulas;
  } else {
    const registryEntry = RECIPE_REGISTRY[recipe.mode];
    if (registryEntry) {
      formulas = registryEntry.fn(recipe.controls ?? registryEntry.defaults);
    } else {
      formulas = compileRecipe(recipe.mode, recipe.parameters ?? defaultParameters());
    }
  }

  // -------------------------------------------------------------------------
  // 2. Mood knob — surfaceContrast fixed at 50 to neutralize computeTones() scaling [D04]
  // signalIntensity and warmth removed from MoodKnobs (warmth removed in Step 2,
  // signalIntensity now derived from formulas.signalIntensityValue in computeTones).
  // -------------------------------------------------------------------------
  const knobs: MoodKnobs = { surfaceContrast: 50 };

  // -------------------------------------------------------------------------
  // 3. Layer 1 — resolve all hue slots (Spec S02)
  // -------------------------------------------------------------------------
  const resolvedSlots = resolveHueSlots(recipe, formulas);

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
