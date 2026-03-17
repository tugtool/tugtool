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
 * are expressed entirely as data in BRIO_DARK_FORMULAS (and future recipe formulas)
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

// ---------------------------------------------------------------------------
// Public interfaces — Spec S01 / S02
// ---------------------------------------------------------------------------

/**
 * Compact recipe input. Minimum 3 values (mode + cardBg + text);
 * full control with ~16. Spec S01.
 */
export interface ThemeRecipe {
  name: string;
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
  /** All formula constants for this recipe. Falls back to BRIO_DARK_FORMULAS when absent. [D02] */
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
 * Normative gate: `lcPass` (Lc threshold per role, SA98G-based).
 * Informational: `wcagRatio` retained for display in the contrast dashboard.
 */
export interface ContrastResult {
  fg: string;
  bg: string;
  wcagRatio: number;
  lc: number;
  lcPass: boolean;
  role: "body-text" | "large-text" | "ui-component" | "decorative";
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
 * Output from deriveTheme(). Spec S02.
 * contrastResults and cvdWarnings are populated in later steps.
 */
export interface ThemeOutput {
  name: string;
  mode: "dark" | "light";
  tokens: Record<string, string>;
  resolved: Record<string, ResolvedColor>;
  contrastResults: ContrastResult[];
  cvdWarnings: CVDWarning[];
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
 * `BRIO_DARK_FORMULAS` when absent). [D02]
 *
 * Field groups:
 *   Surface tone anchors, surface intensities, foreground tone anchors,
 *   text intensities, border parameters, shadow/overlay alphas,
 *   control emphasis parameters, hue slot fields, sentinel hue slot fields,
 *   alpha values for sentinel tokens, formula parameter fields,
 *   badge tinted parameters, per-state control emphasis fields.
 *
 * Spec S01.
 */
export interface DerivationFormulas {
  // -------------------------------------------------------------------------
  // Surface tone anchors (absolute tone values at surfaceContrast=50)
  // -------------------------------------------------------------------------
  bgAppTone: number;
  bgCanvasTone: number;
  surfaceSunkenTone: number;
  surfaceDefaultTone: number;
  surfaceRaisedTone: number;
  surfaceOverlayTone: number;
  surfaceInsetTone: number;
  surfaceContentTone: number;
  surfaceScreenTone: number;

  // -------------------------------------------------------------------------
  // Surface intensity — independent per-tier values.
  // -------------------------------------------------------------------------
  atmI: number;
  surfaceOverlayI: number;
  surfaceScreenI: number;

  // Per-tier surface intensity overrides (Spec S05).
  bgAppI: number;
  bgCanvasI: number;
  surfaceDefaultI: number;
  surfaceRaisedI: number;
  surfaceInsetI: number;
  surfaceContentI: number;

  // -------------------------------------------------------------------------
  // Foreground tone anchors
  // -------------------------------------------------------------------------
  fgDefaultTone: number;
  fgMutedTone: number;
  fgSubtleTone: number;
  fgDisabledTone: number;
  fgPlaceholderTone: number;
  fgInverseTone: number;

  // -------------------------------------------------------------------------
  // Text intensity levels
  // -------------------------------------------------------------------------
  txtI: number;
  txtISubtle: number;
  fgMutedI: number;
  atmIBorder: number;

  // Foreground intensity overrides (Spec S05)
  fgInverseI: number;
  fgOnCautionI: number;
  fgOnSuccessI: number;

  // -------------------------------------------------------------------------
  // Border parameters
  // -------------------------------------------------------------------------
  borderIBase: number;
  borderIStrong: number;

  // Border/divider mode-dependent tones and intensities (Spec S05)
  borderMutedTone: number;
  borderMutedI: number;
  borderStrongTone: number;

  // Divider intensity overrides (Spec S05)
  dividerDefaultI: number;
  dividerMutedI: number;

  // -------------------------------------------------------------------------
  // Card frame intensity (title bar / tab bar bg)
  // -------------------------------------------------------------------------
  cardFrameActiveI: number;
  cardFrameActiveTone: number;
  cardFrameInactiveI: number;
  cardFrameInactiveTone: number;

  // Hue slot fields — tab title bar (card frame) bg (Spec S05)
  tabBgActiveHueSlot: string;
  tabBgInactiveHueSlot: string;

  // -------------------------------------------------------------------------
  // Shadow / overlay alphas
  // -------------------------------------------------------------------------
  shadowXsAlpha: number;
  shadowMdAlpha: number;
  shadowLgAlpha: number;
  shadowXlAlpha: number;
  shadowOverlayAlpha: number;
  overlayDimAlpha: number;
  overlayScrimAlpha: number;
  overlayHighlightAlpha: number;

  // -------------------------------------------------------------------------
  // Control emphasis parameters
  // -------------------------------------------------------------------------
  filledBgDarkTone: number;
  filledBgHoverTone: number;
  filledBgActiveTone: number;

  // -------------------------------------------------------------------------
  // Icon tone/intensity overrides (Spec S05)
  // -------------------------------------------------------------------------
  iconActiveTone: number;
  /** icon-muted intensity */
  iconMutedI: number;
  /** icon-muted tone */
  iconMutedTone: number;

  // -------------------------------------------------------------------------
  // Tab tone overrides (Spec S05)
  // -------------------------------------------------------------------------
  tabFgActiveTone: number;

  // -------------------------------------------------------------------------
  // Toggle tone
  // -------------------------------------------------------------------------
  toggleTrackOnHoverTone: number;
  toggleThumbDisabledTone: number;
  toggleTrackDisabledI: number;

  // -------------------------------------------------------------------------
  // Field tone anchors
  // -------------------------------------------------------------------------
  fieldBgRestTone: number;
  fieldBgHoverTone: number;
  fieldBgFocusTone: number;
  fieldBgDisabledTone: number;
  fieldBgReadOnlyTone: number;

  // Field intensity overrides (Spec S05)
  fieldBgRestI: number;

  // -------------------------------------------------------------------------
  // Control disabled parameters (Spec S05)
  // -------------------------------------------------------------------------
  disabledBgI: number;
  disabledBorderI: number;

  // -------------------------------------------------------------------------
  // Formula parameter fields for non-standard tone computations (Spec S03)
  // -------------------------------------------------------------------------
  bgCanvasToneBase: number;
  bgCanvasToneSCCenter: number;
  bgCanvasToneScale: number;

  disabledBgBase: number;
  disabledBgScale: number;

  // -------------------------------------------------------------------------
  // Badge tinted emphasis formula parameters
  // -------------------------------------------------------------------------
  badgeTintedFgI: number;
  badgeTintedFgTone: number;
  badgeTintedBgI: number;
  badgeTintedBgTone: number;
  badgeTintedBgAlpha: number;
  badgeTintedBorderI: number;
  badgeTintedBorderTone: number;
  badgeTintedBorderAlpha: number;

  // -------------------------------------------------------------------------
  // Hue slot fields — surface tiers (Spec S05)
  // -------------------------------------------------------------------------
  bgAppHueSlot: string;
  bgCanvasHueSlot: string;
  surfaceSunkenHueSlot: string;
  surfaceDefaultHueSlot: string;
  surfaceRaisedHueSlot: string;
  surfaceOverlayHueSlot: string;
  surfaceInsetHueSlot: string;
  surfaceContentHueSlot: string;
  surfaceScreenHueSlot: string;

  // -------------------------------------------------------------------------
  // Hue slot fields — foreground tiers (Spec S05)
  // -------------------------------------------------------------------------
  fgMutedHueSlot: string;
  fgSubtleHueSlot: string;
  fgDisabledHueSlot: string;
  fgPlaceholderHueSlot: string;
  fgInverseHueSlot: string;
  fgOnAccentHueSlot: string;

  // -------------------------------------------------------------------------
  // Hue slot fields — icon tiers (Spec S05)
  // -------------------------------------------------------------------------
  iconMutedHueSlot: string;
  iconOnAccentHueSlot: string;

  // -------------------------------------------------------------------------
  // Hue slot fields — border/divider tiers (Spec S05)
  // -------------------------------------------------------------------------
  dividerMutedHueSlot: string;

  // -------------------------------------------------------------------------
  // Hue slot fields — control disabled (Spec S05)
  // -------------------------------------------------------------------------
  disabledBgHueSlot: string;

  // -------------------------------------------------------------------------
  // Hue slot fields — field (Spec S05)
  // -------------------------------------------------------------------------
  fieldBgHoverHueSlot: string;
  fieldBgReadOnlyHueSlot: string;
  fieldPlaceholderHueSlot: string;
  fieldBorderRestHueSlot: string;
  fieldBorderHoverHueSlot: string;

  // -------------------------------------------------------------------------
  // Hue slot fields — toggle (Spec S05)
  // -------------------------------------------------------------------------
  toggleTrackDisabledHueSlot: string;
  toggleThumbHueSlot: string;
  checkmarkHueSlot: string;
  radioDotHueSlot: string;

  // -------------------------------------------------------------------------
  // Sentinel hue slot fields — structural dispatch per mode [D07]
  // -------------------------------------------------------------------------
  outlinedBgHoverHueSlot: string;
  outlinedBgActiveHueSlot: string;
  ghostActionBgHoverHueSlot: string;
  ghostActionBgActiveHueSlot: string;
  ghostOptionBgHoverHueSlot: string;
  ghostOptionBgActiveHueSlot: string;
  tabBgHoverHueSlot: string;
  tabCloseBgHoverHueSlot: string;
  highlightHoverHueSlot: string;

  // -------------------------------------------------------------------------
  // Alpha values for sentinel-dispatched tokens [D07]
  // -------------------------------------------------------------------------
  tabBgHoverAlpha: number;
  tabCloseBgHoverAlpha: number;
  outlinedBgHoverAlpha: number;
  outlinedBgActiveAlpha: number;
  ghostActionBgHoverAlpha: number;
  ghostActionBgActiveAlpha: number;
  ghostOptionBgHoverAlpha: number;
  ghostOptionBgActiveAlpha: number;
  highlightHoverAlpha: number;
  ghostDangerBgHoverAlpha: number;
  ghostDangerBgActiveAlpha: number;

  // -------------------------------------------------------------------------
  // Per-state control emphasis fields [D10]
  // -------------------------------------------------------------------------
  outlinedFgTone: number;
  outlinedFgI: number;

  // Outlined-action fg per-state light tones
  outlinedActionFgRestToneLight: number;
  outlinedActionFgHoverToneLight: number;
  outlinedActionFgActiveToneLight: number;
  // Outlined-action icon per-state light
  outlinedActionIconRestToneLight: number;
  outlinedActionIconHoverToneLight: number;
  outlinedActionIconActiveToneLight: number;

  // Outlined-agent fg/icon
  outlinedAgentFgRestToneLight: number;
  outlinedAgentFgHoverToneLight: number;
  outlinedAgentFgActiveToneLight: number;
  outlinedAgentIconRestToneLight: number;
  outlinedAgentIconHoverToneLight: number;
  outlinedAgentIconActiveToneLight: number;

  // Outlined-option fg/icon
  outlinedOptionFgRestToneLight: number;
  outlinedOptionFgHoverToneLight: number;
  outlinedOptionFgActiveToneLight: number;
  outlinedOptionIconRestToneLight: number;
  outlinedOptionIconHoverToneLight: number;
  outlinedOptionIconActiveToneLight: number;

  // Ghost-action fg/icon dark (uniform across states)
  ghostActionFgTone: number;
  ghostActionFgI: number;
  // Ghost-action fg per-state light
  ghostActionFgRestToneLight: number;
  ghostActionFgHoverToneLight: number;
  ghostActionFgActiveToneLight: number;
  ghostActionFgRestILight: number;
  ghostActionFgHoverILight: number;
  ghostActionFgActiveILight: number;
  // Ghost-action icon per-state light
  ghostActionIconRestToneLight: number;
  ghostActionIconHoverToneLight: number;
  ghostActionIconActiveToneLight: number;
  ghostActionIconActiveILight: number;
  // Ghost-action border
  ghostActionBorderI: number;
  ghostActionBorderTone: number;

  // Ghost-option fg/icon
  ghostOptionFgTone: number;
  ghostOptionFgI: number;
  ghostOptionFgRestToneLight: number;
  ghostOptionFgHoverToneLight: number;
  ghostOptionFgActiveToneLight: number;
  ghostOptionFgRestILight: number;
  ghostOptionFgHoverILight: number;
  ghostOptionFgActiveILight: number;
  ghostOptionIconRestToneLight: number;
  ghostOptionIconHoverToneLight: number;
  ghostOptionIconActiveToneLight: number;
  ghostOptionIconActiveILight: number;
  ghostOptionBorderI: number;
  ghostOptionBorderTone: number;

  // Outlined-option border tones
  outlinedOptionBorderRestTone: number;
  outlinedOptionBorderHoverTone: number;
  outlinedOptionBorderActiveTone: number;

  // -------------------------------------------------------------------------
  // NEW: Unified per-state control emphasis fields [D05] Spec S04 Table T01
  // These replace the old split dark/light fields in rule expressions.
  // Dark values match the old dark-mode uniform values; future light recipes
  // set these to their light-mode per-state values.
  // -------------------------------------------------------------------------

  // Outlined-action fg — 3 states x (tone + intensity) = 6 fields
  outlinedActionFgRestTone: number;
  outlinedActionFgHoverTone: number;
  outlinedActionFgActiveTone: number;
  outlinedActionFgRestI: number;
  outlinedActionFgHoverI: number;
  outlinedActionFgActiveI: number;

  // Outlined-action icon — 3 states x (tone + intensity) = 6 fields
  outlinedActionIconRestTone: number;
  outlinedActionIconHoverTone: number;
  outlinedActionIconActiveTone: number;
  outlinedActionIconRestI: number;
  outlinedActionIconHoverI: number;
  outlinedActionIconActiveI: number;

  // Outlined-agent fg/icon — same pattern, 12 fields
  outlinedAgentFgRestTone: number;
  outlinedAgentFgHoverTone: number;
  outlinedAgentFgActiveTone: number;
  outlinedAgentFgRestI: number;
  outlinedAgentFgHoverI: number;
  outlinedAgentFgActiveI: number;
  outlinedAgentIconRestTone: number;
  outlinedAgentIconHoverTone: number;
  outlinedAgentIconActiveTone: number;
  outlinedAgentIconRestI: number;
  outlinedAgentIconHoverI: number;
  outlinedAgentIconActiveI: number;

  // Outlined-option fg/icon — same pattern, 12 fields
  outlinedOptionFgRestTone: number;
  outlinedOptionFgHoverTone: number;
  outlinedOptionFgActiveTone: number;
  outlinedOptionFgRestI: number;
  outlinedOptionFgHoverI: number;
  outlinedOptionFgActiveI: number;
  outlinedOptionIconRestTone: number;
  outlinedOptionIconHoverTone: number;
  outlinedOptionIconActiveTone: number;
  outlinedOptionIconRestI: number;
  outlinedOptionIconHoverI: number;
  outlinedOptionIconActiveI: number;

  // Ghost-action fg — 3 states x (tone + intensity) = 6 fields
  ghostActionFgRestTone: number;
  ghostActionFgHoverTone: number;
  ghostActionFgActiveTone: number;
  ghostActionFgRestI: number;
  ghostActionFgHoverI: number;
  ghostActionFgActiveI: number;

  // Ghost-action icon — 3 states x (tone + intensity) = 6 fields
  ghostActionIconRestTone: number;
  ghostActionIconHoverTone: number;
  ghostActionIconActiveTone: number;
  ghostActionIconRestI: number;
  ghostActionIconHoverI: number;
  ghostActionIconActiveI: number;

  // Ghost-option fg/icon — same pattern as ghost-action, 12 fields
  ghostOptionFgRestTone: number;
  ghostOptionFgHoverTone: number;
  ghostOptionFgActiveTone: number;
  ghostOptionFgRestI: number;
  ghostOptionFgHoverI: number;
  ghostOptionFgActiveI: number;
  ghostOptionIconRestTone: number;
  ghostOptionIconHoverTone: number;
  ghostOptionIconActiveTone: number;
  ghostOptionIconRestI: number;
  ghostOptionIconHoverI: number;
  ghostOptionIconActiveI: number;

  // Non-control isLight branch replacements [D05] Table T01
  /** bg-app intensity. Dark: bgAppI (2). Light: atmI. */
  bgAppSurfaceI: number;
  /** border-strong tone. Dark: fgSubtleTone (37). */
  borderStrongToneValue: number;
  /** outlined bg-hover intensity. Dark: 0 (highlight sentinel). Light: 4. */
  outlinedBgHoverI: number;
  /** outlined bg-hover alpha. Dark: outlinedBgHoverAlpha (10). Light: 100. */
  outlinedBgHoverAlphaValue: number;
  /** outlined bg-active intensity. Dark: 0 (highlight sentinel). Light: 6. */
  outlinedBgActiveI: number;
  /** outlined bg-active alpha. Dark: outlinedBgActiveAlpha (20). Light: 100. */
  outlinedBgActiveAlphaValue: number;
  /** selection-bg-inactive intensity. Dark: 0. Light: 8. */
  selectionBgInactiveI: number;
  /** selection-bg-inactive tone. Dark: 30. Light: 24. */
  selectionBgInactiveTone: number;
  /** selection-bg-inactive alpha. Dark: 25. Light: 20. */
  selectionBgInactiveAlpha: number;

  // -------------------------------------------------------------------------
  // NEW: Derived hue-name fields for resolveHueSlots() branch elimination [D03]
  // Spec S02 (#s02-hue-name-fields)
  // -------------------------------------------------------------------------

  /** Hue name for the surfScreen derived slot. Dark: "indigo". */
  surfScreenHue: string;

  /**
   * Expression for the fgMuted derived slot hue.
   * "__bare_primary" = use the bare primary segment of txtHue (e.g. "cobalt" from "indigo-cobalt").
   * Any other value = treat as a literal hue name.
   */
  fgMutedHueExpr: string;

  /** Hue name for the fgSubtle derived slot. Dark: "indigo-cobalt". */
  fgSubtleHue: string;

  /** Hue name for the fgDisabled derived slot. Dark: "indigo-cobalt". */
  fgDisabledHue: string;

  /** Hue name for the fgInverse derived slot. Dark: "sapphire-cobalt". */
  fgInverseHue: string;

  /**
   * Source for the fgPlaceholder derived slot.
   * "fgMuted" = copy from fgMuted slot.
   * "atm"     = copy from atm slot.
   */
  fgPlaceholderSource: string;

  /**
   * Hue name for the selectionInactive derived slot.
   * Used only when selectionInactiveSemanticMode is true.
   * Dark: "yellow".
   */
  selectionInactiveHue: string;

  /**
   * When true: use resolveSemanticSlot(selectionInactiveHue) — no warmth bias.
   * When false: compute atm offset (atmBaseAngle - 20°) with warmth bias.
   * Dark: true.
   */
  selectionInactiveSemanticMode: boolean;

  // -------------------------------------------------------------------------
  // NEW: Computed-tone override fields for computeTones() branch elimination [D04]
  // Spec S03 (#s03-computed-tone-fields)
  // Convention: number = use this flat value; null = derive from formula.
  // -------------------------------------------------------------------------

  /**
   * Flat tone for divider-default. null = Math.round(surfaceOverlay - 2).
   * Dark: 17.
   */
  dividerDefaultToneOverride: number | null;

  /**
   * Flat tone for divider-muted. null = Math.round(surfaceOverlay).
   * Dark: 15.
   */
  dividerMutedToneOverride: number | null;

  /**
   * Flat tone for disabled-fg. Always a number (dark: 38; future light uses fgDisabledTone).
   */
  disabledFgToneValue: number;

  /**
   * Flat tone for disabled-border. null = Math.round(dividerTone).
   * Dark: 28.
   */
  disabledBorderToneOverride: number | null;

  /**
   * Flat tone for outlined-bg-rest. null = Math.round(surfaceInset + 2).
   * Dark: null (derives from formula).
   */
  outlinedBgRestToneOverride: number | null;

  /**
   * Flat tone for outlined-bg-hover. null = Math.round(surfaceRaised + 1).
   * Dark: null (derives from formula).
   */
  outlinedBgHoverToneOverride: number | null;

  /**
   * Flat tone for outlined-bg-active. null = Math.round(surfaceOverlay).
   * Dark: null (derives from formula).
   */
  outlinedBgActiveToneOverride: number | null;

  /**
   * Flat tone for toggle-track-off. null = Math.round(dividerTone).
   * Dark: 28.
   */
  toggleTrackOffToneOverride: number | null;

  /**
   * Flat tone for toggle-disabled. null = Math.round(surfaceOverlay).
   * Dark: 22.
   */
  toggleDisabledToneOverride: number | null;
}

// ---------------------------------------------------------------------------
// BRIO_DARK_FORMULAS — Brio dark formula constants [D01] [D02]
// ---------------------------------------------------------------------------

/**
 * All formula constants for the Brio dark recipe.
 * Single source of truth for all Brio dark derivation constants.
 * Exported as the default fallback in `deriveTheme()` via
 * `recipe.formulas ?? BRIO_DARK_FORMULAS`. [D02]
 *
 * Also referenced by `EXAMPLE_RECIPES.brio.formulas`.
 */
export const BRIO_DARK_FORMULAS: DerivationFormulas = {
  // Surface tones (Brio ground truth at surfaceContrast=50)
  bgAppTone: 5,
  bgCanvasTone: 5,
  surfaceSunkenTone: 11,
  surfaceDefaultTone: 12,
  surfaceRaisedTone: 11,
  surfaceOverlayTone: 14,
  surfaceInsetTone: 6,
  surfaceContentTone: 6,
  surfaceScreenTone: 16,

  // Surface intensities
  atmI: 5,
  surfaceOverlayI: 4,
  surfaceScreenI: 7,

  // Per-tier surface intensity overrides (dark: bg-app and bg-canvas use i=2)
  bgAppI: 2,
  bgCanvasI: 2,
  surfaceDefaultI: 5,
  surfaceRaisedI: 5,
  surfaceInsetI: 5,
  surfaceContentI: 5,

  // Foreground tones (Brio ground truth)
  fgDefaultTone: 94,
  fgMutedTone: 66,
  fgSubtleTone: 37,
  fgDisabledTone: 23,
  fgPlaceholderTone: 30,
  fgInverseTone: 100,

  // Text intensities
  txtI: 3,
  txtISubtle: 7,
  fgMutedI: 5,
  atmIBorder: 6,

  // Foreground intensity overrides (dark)
  fgInverseI: 3,
  fgOnCautionI: 4,
  fgOnSuccessI: 4,

  // Border intensities
  borderIBase: 6,
  borderIStrong: 7,

  // Border/divider mode-dependent tones/intensities (dark)
  borderMutedTone: 37,
  borderMutedI: 7,
  borderStrongTone: 40,

  // Divider intensity (dark)
  dividerDefaultI: 6,
  dividerMutedI: 4,

  // Card frame
  cardFrameActiveI: 12,
  cardFrameActiveTone: 18,
  cardFrameInactiveI: 4,
  cardFrameInactiveTone: 15,

  // Tab bg hue slots (dark: cardFrame)
  tabBgActiveHueSlot: "cardFrame",
  tabBgInactiveHueSlot: "cardFrame",

  // Shadow / overlay alphas (Brio dark)
  shadowXsAlpha: 20,
  shadowMdAlpha: 60,
  shadowLgAlpha: 70,
  shadowXlAlpha: 80,
  shadowOverlayAlpha: 60,
  overlayDimAlpha: 48,
  overlayScrimAlpha: 64,
  overlayHighlightAlpha: 6,

  // Control emphasis tones (filled button bg)
  filledBgDarkTone: 20,
  filledBgHoverTone: 40,
  filledBgActiveTone: 50,

  // Icon tone/intensity overrides (dark)
  iconActiveTone: 80,
  iconMutedI: 7,
  iconMutedTone: 37,

  // Tab tone overrides (dark)
  tabFgActiveTone: 90,

  // Toggle tones (dark)
  toggleTrackOnHoverTone: 45,
  toggleThumbDisabledTone: 40,
  toggleTrackDisabledI: 5,

  // Field tones (Brio dark ground truth)
  fieldBgRestTone: 8,
  fieldBgHoverTone: 11,
  fieldBgFocusTone: 7,
  fieldBgDisabledTone: 6,
  fieldBgReadOnlyTone: 11,

  // Field intensity (dark)
  fieldBgRestI: 5,

  // Control disabled (dark)
  disabledBgI: 5,
  disabledBorderI: 6,

  // Formula parameter fields (dark)
  bgCanvasToneBase: 5,
  bgCanvasToneSCCenter: 50,
  bgCanvasToneScale: 8,
  disabledBgBase: 22,
  disabledBgScale: 0,

  // Badge tinted emphasis formula parameters
  badgeTintedFgI: 72,
  badgeTintedFgTone: 85,
  badgeTintedBgI: 65,
  badgeTintedBgTone: 60,
  badgeTintedBgAlpha: 15,
  badgeTintedBorderI: 50,
  badgeTintedBorderTone: 50,
  badgeTintedBorderAlpha: 35,

  // Hue slot fields — surface tiers (dark)
  bgAppHueSlot: "canvas",
  bgCanvasHueSlot: "canvas",
  surfaceSunkenHueSlot: "surfBareBase",
  surfaceDefaultHueSlot: "surfBareBase",
  surfaceRaisedHueSlot: "atm",
  surfaceOverlayHueSlot: "surfBareBase",
  surfaceInsetHueSlot: "atm",
  surfaceContentHueSlot: "atm",
  surfaceScreenHueSlot: "surfScreen",

  // Hue slot fields — foreground tiers (dark)
  fgMutedHueSlot: "fgMuted",
  fgSubtleHueSlot: "fgSubtle",
  fgDisabledHueSlot: "fgDisabled",
  fgPlaceholderHueSlot: "fgPlaceholder",
  fgInverseHueSlot: "fgInverse",
  fgOnAccentHueSlot: "fgInverse",

  // Hue slot fields — icon tiers (dark)
  iconMutedHueSlot: "fgSubtle",
  iconOnAccentHueSlot: "fgInverse",

  // Hue slot fields — border/divider (dark)
  dividerMutedHueSlot: "borderTintBareBase",

  // Hue slot fields — control disabled (dark)
  disabledBgHueSlot: "surfBareBase",

  // Hue slot fields — field (dark)
  fieldBgHoverHueSlot: "surfBareBase",
  fieldBgReadOnlyHueSlot: "surfBareBase",
  fieldPlaceholderHueSlot: "fgPlaceholder",
  fieldBorderRestHueSlot: "fgPlaceholder",
  fieldBorderHoverHueSlot: "fgSubtle",

  // Hue slot fields — toggle (dark)
  toggleTrackDisabledHueSlot: "surfBareBase",
  toggleThumbHueSlot: "fgInverse",
  checkmarkHueSlot: "fgInverse",
  radioDotHueSlot: "fgInverse",

  // Sentinel hue slot fields (dark) [D07]
  outlinedBgHoverHueSlot: "__highlight",
  outlinedBgActiveHueSlot: "__highlight",
  ghostActionBgHoverHueSlot: "__highlight",
  ghostActionBgActiveHueSlot: "__highlight",
  ghostOptionBgHoverHueSlot: "__highlight",
  ghostOptionBgActiveHueSlot: "__highlight",
  tabBgHoverHueSlot: "__highlight",
  tabCloseBgHoverHueSlot: "__highlight",
  highlightHoverHueSlot: "__verboseHighlight",

  // Alpha values for sentinel-dispatched tokens (dark)
  tabBgHoverAlpha: 8,
  tabCloseBgHoverAlpha: 12,
  outlinedBgHoverAlpha: 10,
  outlinedBgActiveAlpha: 20,
  ghostActionBgHoverAlpha: 10,
  ghostActionBgActiveAlpha: 20,
  ghostOptionBgHoverAlpha: 10,
  ghostOptionBgActiveAlpha: 20,
  highlightHoverAlpha: 5,
  ghostDangerBgHoverAlpha: 10,
  ghostDangerBgActiveAlpha: 20,

  // Per-state control emphasis fields (dark)
  outlinedFgTone: 100,
  outlinedFgI: 2,

  outlinedActionFgRestToneLight: 0,
  outlinedActionFgHoverToneLight: 0,
  outlinedActionFgActiveToneLight: 0,
  outlinedActionIconRestToneLight: 0,
  outlinedActionIconHoverToneLight: 0,
  outlinedActionIconActiveToneLight: 0,

  outlinedAgentFgRestToneLight: 0,
  outlinedAgentFgHoverToneLight: 0,
  outlinedAgentFgActiveToneLight: 0,
  outlinedAgentIconRestToneLight: 0,
  outlinedAgentIconHoverToneLight: 0,
  outlinedAgentIconActiveToneLight: 0,

  outlinedOptionFgRestToneLight: 0,
  outlinedOptionFgHoverToneLight: 0,
  outlinedOptionFgActiveToneLight: 0,
  outlinedOptionIconRestToneLight: 0,
  outlinedOptionIconHoverToneLight: 0,
  outlinedOptionIconActiveToneLight: 0,

  ghostActionFgTone: 100,
  ghostActionFgI: 2,
  ghostActionFgRestToneLight: 0,
  ghostActionFgHoverToneLight: 0,
  ghostActionFgActiveToneLight: 0,
  ghostActionFgRestILight: 0,
  ghostActionFgHoverILight: 0,
  ghostActionFgActiveILight: 0,
  ghostActionIconRestToneLight: 0,
  ghostActionIconHoverToneLight: 0,
  ghostActionIconActiveToneLight: 0,
  ghostActionIconActiveILight: 0,
  ghostActionBorderI: 20,
  ghostActionBorderTone: 60,

  ghostOptionFgTone: 100,
  ghostOptionFgI: 2,
  ghostOptionFgRestToneLight: 0,
  ghostOptionFgHoverToneLight: 0,
  ghostOptionFgActiveToneLight: 0,
  ghostOptionFgRestILight: 0,
  ghostOptionFgHoverILight: 0,
  ghostOptionFgActiveILight: 0,
  ghostOptionIconRestToneLight: 0,
  ghostOptionIconHoverToneLight: 0,
  ghostOptionIconActiveToneLight: 0,
  ghostOptionIconActiveILight: 0,
  ghostOptionBorderI: 20,
  ghostOptionBorderTone: 60,

  outlinedOptionBorderRestTone: 50,
  outlinedOptionBorderHoverTone: 55,
  outlinedOptionBorderActiveTone: 60,

  // Unified per-state control emphasis fields [D05] Spec S04 Table T01
  // Dark: all fg tones = 100 (outlinedFgTone), all fg/icon intensities = 2 (outlinedFgI)
  outlinedActionFgRestTone: 100,
  outlinedActionFgHoverTone: 100,
  outlinedActionFgActiveTone: 100,
  outlinedActionFgRestI: 2,
  outlinedActionFgHoverI: 2,
  outlinedActionFgActiveI: 2,

  outlinedActionIconRestTone: 100,
  outlinedActionIconHoverTone: 100,
  outlinedActionIconActiveTone: 100,
  outlinedActionIconRestI: 2,
  outlinedActionIconHoverI: 2,
  outlinedActionIconActiveI: 2,

  outlinedAgentFgRestTone: 100,
  outlinedAgentFgHoverTone: 100,
  outlinedAgentFgActiveTone: 100,
  outlinedAgentFgRestI: 2,
  outlinedAgentFgHoverI: 2,
  outlinedAgentFgActiveI: 2,
  outlinedAgentIconRestTone: 100,
  outlinedAgentIconHoverTone: 100,
  outlinedAgentIconActiveTone: 100,
  outlinedAgentIconRestI: 2,
  outlinedAgentIconHoverI: 2,
  outlinedAgentIconActiveI: 2,

  outlinedOptionFgRestTone: 100,
  outlinedOptionFgHoverTone: 100,
  outlinedOptionFgActiveTone: 100,
  outlinedOptionFgRestI: 2,
  outlinedOptionFgHoverI: 2,
  outlinedOptionFgActiveI: 2,
  outlinedOptionIconRestTone: 100,
  outlinedOptionIconHoverTone: 100,
  outlinedOptionIconActiveTone: 100,
  outlinedOptionIconRestI: 2,
  outlinedOptionIconHoverI: 2,
  outlinedOptionIconActiveI: 2,

  ghostActionFgRestTone: 100,
  ghostActionFgHoverTone: 100,
  ghostActionFgActiveTone: 100,
  ghostActionFgRestI: 2,
  ghostActionFgHoverI: 2,
  ghostActionFgActiveI: 2,

  ghostActionIconRestTone: 100,
  ghostActionIconHoverTone: 100,
  ghostActionIconActiveTone: 100,
  ghostActionIconRestI: 2,
  ghostActionIconHoverI: 2,
  ghostActionIconActiveI: 2,

  ghostOptionFgRestTone: 100,
  ghostOptionFgHoverTone: 100,
  ghostOptionFgActiveTone: 100,
  ghostOptionFgRestI: 2,
  ghostOptionFgHoverI: 2,
  ghostOptionFgActiveI: 2,
  ghostOptionIconRestTone: 100,
  ghostOptionIconHoverTone: 100,
  ghostOptionIconActiveTone: 100,
  ghostOptionIconRestI: 2,
  ghostOptionIconHoverI: 2,
  ghostOptionIconActiveI: 2,

  // Non-control isLight branch replacements (dark values) [D05] Table T01
  bgAppSurfaceI: 2,           // dark: bgAppI
  borderStrongToneValue: 37,  // dark: fgSubtleTone
  outlinedBgHoverI: 0,
  outlinedBgHoverAlphaValue: 10,
  outlinedBgActiveI: 0,
  outlinedBgActiveAlphaValue: 20,
  selectionBgInactiveI: 0,
  selectionBgInactiveTone: 30,
  selectionBgInactiveAlpha: 25,

  // Derived hue-name fields for resolveHueSlots() branch elimination (Spec S02)
  surfScreenHue: "indigo",
  fgMutedHueExpr: "__bare_primary",
  fgSubtleHue: "indigo-cobalt",
  fgDisabledHue: "indigo-cobalt",
  fgInverseHue: "sapphire-cobalt",
  fgPlaceholderSource: "fgMuted",
  selectionInactiveHue: "yellow",
  selectionInactiveSemanticMode: true,

  // Computed-tone override fields (Spec S03)
  dividerDefaultToneOverride: 17,
  dividerMutedToneOverride: 15,
  disabledFgToneValue: 38,
  disabledBorderToneOverride: 28,
  outlinedBgRestToneOverride: null,
  outlinedBgHoverToneOverride: null,
  outlinedBgActiveToneOverride: null,
  toggleTrackOffToneOverride: 28,
  toggleDisabledToneOverride: 22,
};

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
    mode: "dark",
    cardBg: { hue: "indigo-violet" },
    text: { hue: "cobalt" },
    link: "cyan",            // [D05]: link/selection/highlight use cyan; active stays blue
    canvas: "indigo-violet", // bg-canvas, bg-app use same hue as cardBg
    cardFrame: "indigo",     // card title bar, tab bar bg
    borderTint: "indigo-violet", // borders and dividers use same hue as cardBg
    formulas: BRIO_DARK_FORMULAS,
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
 * @param formulas - Formula constants; defaults to recipe.formulas ?? BRIO_DARK_FORMULAS
 */
export function resolveHueSlots(
  recipe: ThemeRecipe,
  warmth: number,
  formulas: DerivationFormulas = recipe.formulas ?? BRIO_DARK_FORMULAS,
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
 * @param rules         Named rule table (token name → DerivationRule)
 * @param resolvedSlots Output of resolveHueSlots()
 * @param formulas      Active DerivationFormulas for this recipe
 * @param knobs         Normalized mood knobs
 * @param computed      Output of computeTones()
 * @param tokens        Output map for CSS token strings (mutated in place)
 * @param resolved      Output map for OKLCH resolved colors (mutated in place)
 * @param makeShadow    Internal helper: build compact black-a string
 * @param makeHighlight Internal helper: build compact white-a string
 * @param makeVerboseHighlight Internal helper: build verbose white-i0-t100-a string
 * @param blackResolved Resolved OKLCH for black
 * @param whiteResolved Resolved OKLCH for white
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

        // Sentinel check [D07]
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
        const t = Math.round(rule.toneExpr(formulas, knobs, computed));
        const a = rule.alphaExpr ? Math.round(rule.alphaExpr(formulas, knobs, computed)) : 100;
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
  // recipe.formulas when provided, else Brio dark default. [D02]
  // Silent fallback: the only production recipe is Brio dark.
  // -------------------------------------------------------------------------
  const formulas: DerivationFormulas = recipe.formulas ?? BRIO_DARK_FORMULAS;

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
  const desc = `Generated theme (${recipe.mode} mode, cardBg: ${recipe.cardBg.hue}, text: ${recipe.text.hue})`;

  const header = [
    "/**",
    ` * @theme-name ${recipe.name}`,
    ` * @theme-description ${desc}`,
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
