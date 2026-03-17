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
 *   Layer 2 — computeTones(): ModePreset + MoodKnobs → ComputedTones
 *             Pre-computes all derived tone values from mood knobs and mode preset.
 *   Layer 3 — evaluateRules(): RULES table → tokens + resolved maps
 *             Iterates the declarative rule table in derivation-rules.ts, calling
 *             the appropriate helper for each token type.
 *
 * Mood knobs (`surfaceContrast`, `signalIntensity`, `warmth`) modulate tone
 * spreads, intensity levels, and hue angles. Mode differences (dark vs light)
 * are expressed entirely as data in DARK_PRESET / LIGHT_PRESET and the RULES
 * table — deriveTheme() itself contains no mode branching.
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
  },
};

// ---------------------------------------------------------------------------
// ModePreset — mode-specific formula parameters [D03]
// ---------------------------------------------------------------------------

/**
 * Bundles all mode-dependent formula constants into a named preset.
 * `deriveTheme()` selects a preset by `recipe.mode`; the RULES table and
 * computeTones() use preset fields instead of inline mode branches.
 *
 * Hue slot fields hold the slot key that each token should resolve through
 * (Layer 1 / resolveHueSlots). Sentinel values trigger special token types
 * without a hue lookup ([D07]):
 *   "__white"            → white token
 *   "__highlight"        → highlight (white-based, semi-transparent)
 *   "__shadow"           → shadow (black-based, semi-transparent)
 *   "__verboseHighlight" → verbose --tug-color(white, i:0, t:100, a:N)
 *
 * Spec S01, Spec S05.
 */
export interface ModePreset {
  // -------------------------------------------------------------------------
  // Mode flag — used by computeTones() to branch on mode-specific formulas.
  // -------------------------------------------------------------------------
  /** True for light mode, false for dark mode. */
  isLight: boolean;

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
  // Brio dark: atmI=5, overlayI=4, screenI=7 (sunken/default/raised/inset/content use atmI).
  // -------------------------------------------------------------------------
  atmI: number;
  surfaceOverlayI: number;
  surfaceScreenI: number;

  // Per-tier surface intensity overrides (Spec S05).
  // Dark: most tiers use atmI; light uses different values per tier.
  bgAppI: number;          // 2 (dark) | atmI (light)
  bgCanvasI: number;       // 2 (dark) | 7 (light)
  surfaceDefaultI: number; // atmI (dark) | 4 (light)
  surfaceRaisedI: number;  // atmI (dark) | 5 (light)
  surfaceInsetI: number;   // atmI (dark) | 4 (light)
  surfaceContentI: number; // atmI (dark) | 4 (light)

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
  atmIBorder: number; // border/divider intensity (also used for fg-placeholder in light)

  // Foreground intensity overrides (Spec S05)
  fgInverseI: number;   // txtI (dark) | 1 (light)
  fgOnCautionI: number; // 4 (dark) | atmI (light)
  fgOnSuccessI: number; // 4 (dark) | atmI (light)

  // -------------------------------------------------------------------------
  // Border parameters
  // -------------------------------------------------------------------------
  borderIBase: number;
  borderIStrong: number;

  // Border/divider mode-dependent tones and intensities (Spec S05)
  borderMutedTone: number;  // fgSubtleTone (dark) | 36 (light)
  borderMutedI: number;     // borderIStrong (dark) | 10 (light)
  borderStrongTone: number; // 40 (dark) | fgSubtleTone-6 (light)

  // Divider intensity overrides (Spec S05)
  dividerDefaultI: number; // 6 (dark) | atmI (light)
  dividerMutedI: number;   // 4 (dark) | atmI (light)

  // -------------------------------------------------------------------------
  // Card frame intensity (title bar / tab bar bg)
  // -------------------------------------------------------------------------
  cardFrameActiveI: number;   // active title bar (Brio dark: 12)
  cardFrameActiveTone: number;
  cardFrameInactiveI: number; // inactive title bar (Brio dark: 4)
  cardFrameInactiveTone: number;

  // Hue slot fields — tab title bar (card frame) bg (Spec S05)
  tabBgActiveHueSlot: string;   // "cardFrame" (dark) | "atm" (light)
  tabBgInactiveHueSlot: string; // "cardFrame" (dark) | "atm" (light)

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
  iconActiveTone: number; // 80 (dark) | 22 (light)
  /** icon-muted intensity: 7=txtISubtle (dark) | 9=atmIBorder (light) */
  iconMutedI: number;
  /** icon-muted tone: 37=fgSubtleTone (dark) | 28=fgPlaceholderTone (light) */
  iconMutedTone: number;

  // -------------------------------------------------------------------------
  // Tab tone overrides (Spec S05)
  // -------------------------------------------------------------------------
  tabFgActiveTone: number; // 90 (dark) | fgDefaultTone (light)

  // -------------------------------------------------------------------------
  // Toggle tone
  // -------------------------------------------------------------------------
  toggleTrackOnHoverTone: number;
  toggleThumbDisabledTone: number; // 40 (dark) | fgDisabledTone (light)
  toggleTrackDisabledI: number;    // atmI (dark) | 6 (light)

  // -------------------------------------------------------------------------
  // Field tone anchors
  // -------------------------------------------------------------------------
  fieldBgRestTone: number;
  fieldBgHoverTone: number;
  fieldBgFocusTone: number;
  fieldBgDisabledTone: number;
  fieldBgReadOnlyTone: number;

  // Field intensity overrides (Spec S05)
  fieldBgRestI: number; // atmI (dark) | 7 (light)

  // -------------------------------------------------------------------------
  // Control disabled parameters (Spec S05)
  // -------------------------------------------------------------------------
  disabledBgI: number;     // atmI (dark) | 6 (light)
  disabledBorderI: number; // 6 (dark) | atmIBorder (light)

  // -------------------------------------------------------------------------
  // Formula parameter fields for non-standard tone computations (Spec S03)
  // -------------------------------------------------------------------------
  // bgCanvas: dark reuses bgApp formula (same anchor/scale); light uses separate formula.
  // Unified: Math.round(bgCanvasToneBase + ((sc - bgCanvasToneSCCenter) / (bgCanvasToneSCCenter === 0 ? 100 : 50)) * bgCanvasToneScale)
  bgCanvasToneBase: number;     // bgAppTone (dark, = 5) | 35 (light)
  bgCanvasToneSCCenter: number; // 50 (dark) | 0 (light)
  bgCanvasToneScale: number;    // 8 (dark) | 10 (light)

  // disabledBg: dark is flat 22; light is 70 + (sc/100)*10
  disabledBgBase: number;  // 22 (dark) | 70 (light)
  disabledBgScale: number; // 0 (dark) | 10 (light)

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
  // Each field names a key in ResolvedHueSlots or a sentinel string [D07].
  // -------------------------------------------------------------------------
  bgAppHueSlot: string;          // "canvas" (dark) | "txt" (light)
  bgCanvasHueSlot: string;       // "canvas" (dark) | "atm" (light)
  surfaceSunkenHueSlot: string;  // "surfBareBase" (dark) | "atm" (light)
  surfaceDefaultHueSlot: string; // "surfBareBase" (dark) | "atm" (light)
  surfaceRaisedHueSlot: string;  // "atm" (dark) | "txt" (light)
  surfaceOverlayHueSlot: string; // "surfBareBase" (dark) | "atm" (light)
  surfaceInsetHueSlot: string;   // "atm" (dark) | "atm" (light)
  surfaceContentHueSlot: string; // "atm" (dark) | "atm" (light)
  surfaceScreenHueSlot: string;  // "surfScreen" (dark) | "txt" (light)

  // -------------------------------------------------------------------------
  // Hue slot fields — foreground tiers (Spec S05)
  // -------------------------------------------------------------------------
  fgMutedHueSlot: string;      // "fgMuted" (dark) | "txt" (light)
  fgSubtleHueSlot: string;     // "fgSubtle" (dark) | "txt" (light)
  fgDisabledHueSlot: string;   // "fgDisabled" (dark) | "txt" (light)
  fgPlaceholderHueSlot: string; // "fgPlaceholder" (dark) | "atm" (light)
  fgInverseHueSlot: string;    // "fgInverse" (dark) | "txt" (light)
  fgOnAccentHueSlot: string;   // "fgInverse" (dark) | "__white" (light)

  // -------------------------------------------------------------------------
  // Hue slot fields — icon tiers (Spec S05)
  // -------------------------------------------------------------------------
  iconMutedHueSlot: string;    // "fgSubtle" (dark) | "atm" (light)
  iconOnAccentHueSlot: string; // "fgInverse" (dark) | "__white" (light)

  // -------------------------------------------------------------------------
  // Hue slot fields — border/divider tiers (Spec S05)
  // -------------------------------------------------------------------------
  dividerMutedHueSlot: string; // "borderTintBareBase" (dark) | "borderTint" (light)

  // -------------------------------------------------------------------------
  // Hue slot fields — control disabled (Spec S05)
  // -------------------------------------------------------------------------
  disabledBgHueSlot: string; // "surfBareBase" (dark) | "atm" (light)

  // -------------------------------------------------------------------------
  // Hue slot fields — field (Spec S05)
  // -------------------------------------------------------------------------
  fieldBgHoverHueSlot: string;    // "surfBareBase" (dark) | "atm" (light)
  fieldBgReadOnlyHueSlot: string; // "surfBareBase" (dark) | "atm" (light)
  fieldPlaceholderHueSlot: string; // "fgPlaceholder" (dark) | "atm" (light)
  fieldBorderRestHueSlot: string;  // "fgPlaceholder" (dark) | "atm" (light)
  fieldBorderHoverHueSlot: string; // "fgSubtle" (dark) | "borderStrong" (light)

  // -------------------------------------------------------------------------
  // Hue slot fields — toggle (Spec S05)
  // -------------------------------------------------------------------------
  toggleTrackDisabledHueSlot: string; // "surfBareBase" (dark) | "atm" (light)
  toggleThumbHueSlot: string;         // "fgInverse" (dark) | "__white" (light)
  checkmarkHueSlot: string;           // "fgInverse" (dark) | "__white" (light)
  radioDotHueSlot: string;            // "fgInverse" (dark) | "__white" (light)

  // -------------------------------------------------------------------------
  // Sentinel hue slot fields — structural dispatch per mode [D07]
  // Values are ResolvedHueSlots keys or sentinel strings.
  // -------------------------------------------------------------------------
  outlinedBgHoverHueSlot: string;     // "__highlight" (dark) | "atm" (light)
  outlinedBgActiveHueSlot: string;    // "__highlight" (dark) | "atm" (light)
  ghostActionBgHoverHueSlot: string;  // "__highlight" (dark) | "__shadow" (light)
  ghostActionBgActiveHueSlot: string; // "__highlight" (dark) | "__shadow" (light)
  ghostOptionBgHoverHueSlot: string;  // "__highlight" (dark) | "__shadow" (light)
  ghostOptionBgActiveHueSlot: string; // "__highlight" (dark) | "__shadow" (light)
  tabBgHoverHueSlot: string;          // "__highlight" (dark) | "__shadow" (light)
  tabCloseBgHoverHueSlot: string;     // "__highlight" (dark) | "__shadow" (light)
  highlightHoverHueSlot: string;      // "__verboseHighlight" (dark) | "__shadow" (light)

  // -------------------------------------------------------------------------
  // Alpha values for sentinel-dispatched tokens [D07]
  // -------------------------------------------------------------------------
  tabBgHoverAlpha: number;          // 8 (dark, highlight) | 6 (light, shadow)
  tabCloseBgHoverAlpha: number;     // 12 (dark, highlight) | 10 (light, shadow)
  outlinedBgHoverAlpha: number;     // 10 (dark, highlight) | N/A (light, chromatic; unused)
  outlinedBgActiveAlpha: number;    // 20 (dark, highlight) | N/A (light, chromatic; unused)
  ghostActionBgHoverAlpha: number;  // 10 (dark, highlight) | 6 (light, shadow)
  ghostActionBgActiveAlpha: number; // 20 (dark, highlight) | 12 (light, shadow)
  ghostOptionBgHoverAlpha: number;  // 10 (dark, highlight) | 6 (light, shadow)
  ghostOptionBgActiveAlpha: number; // 20 (dark, highlight) | 12 (light, shadow)
  highlightHoverAlpha: number;      // 5 (dark, verboseHighlight) | 4 (light, shadow)
  ghostDangerBgHoverAlpha: number;  // 10 (dark) | 8 (light)
  ghostDangerBgActiveAlpha: number; // 20 (dark) | 15 (light)

  // -------------------------------------------------------------------------
  // Per-state control emphasis fields [D10]
  // Naming convention: {family}{State}{Property}
  // Dark mode uses uniform values across all states (rest/hover/active identical).
  // Light mode has per-state variation.
  // -------------------------------------------------------------------------

  // Shared dark-mode values for outlined/ghost fg/icon (all states identical in dark):
  // tone = filledFgTone (100), I = Math.max(1, txtI - 1) (= 2 for Brio dark)
  outlinedFgTone: number; // 100 (dark, uniform) | per-state (light)
  outlinedFgI: number;    // 2 (dark, uniform) | per-state (light)

  // Outlined-action fg per-state light tones (intensity = txtI in all light states)
  outlinedActionFgRestToneLight: number;   // fgDefaultTone (light)
  outlinedActionFgHoverToneLight: number;  // 10 (light)
  outlinedActionFgActiveToneLight: number; // 8 (light)
  // Outlined-action icon per-state light (intensity = txtISubtle in rest/hover; txtISubtle active)
  outlinedActionIconRestToneLight: number;   // fgMutedTone (light)
  outlinedActionIconHoverToneLight: number;  // 22 (light)
  outlinedActionIconActiveToneLight: number; // 13 (light)

  // Outlined-agent fg/icon — same pattern as outlined-action
  outlinedAgentFgRestToneLight: number;    // fgDefaultTone (light)
  outlinedAgentFgHoverToneLight: number;   // 10 (light)
  outlinedAgentFgActiveToneLight: number;  // 8 (light)
  outlinedAgentIconRestToneLight: number;  // fgMutedTone (light)
  outlinedAgentIconHoverToneLight: number; // 22 (light)
  outlinedAgentIconActiveToneLight: number;// 13 (light)

  // Outlined-option fg/icon — same pattern as outlined-action
  outlinedOptionFgRestToneLight: number;    // fgDefaultTone (light)
  outlinedOptionFgHoverToneLight: number;   // 10 (light)
  outlinedOptionFgActiveToneLight: number;  // 8 (light)
  outlinedOptionIconRestToneLight: number;  // fgMutedTone (light)
  outlinedOptionIconHoverToneLight: number; // 22 (light)
  outlinedOptionIconActiveToneLight: number;// 13 (light)

  // Ghost-action fg/icon dark (uniform across states)
  ghostActionFgTone: number; // 100 (dark, uniform)
  ghostActionFgI: number;    // 2 (dark, uniform)
  // Ghost-action fg per-state light
  ghostActionFgRestToneLight: number;  // fgMutedTone (light)
  ghostActionFgHoverToneLight: number; // 15 (light)
  ghostActionFgActiveToneLight: number;// 10 (light)
  ghostActionFgRestILight: number;     // txtISubtle (light)
  ghostActionFgHoverILight: number;    // 9 (light)
  ghostActionFgActiveILight: number;   // 9 (light)
  // Ghost-action icon per-state light
  ghostActionIconRestToneLight: number;   // fgMutedTone (light)
  ghostActionIconHoverToneLight: number;  // 22 (light)
  ghostActionIconActiveToneLight: number; // 13 (light)
  ghostActionIconActiveILight: number;    // 27 (light; rest/hover use txtISubtle)
  // Ghost-action border (same i/t in both dark and light states for hover/active)
  ghostActionBorderI: number;    // 20 (dark) | 10 (light)
  ghostActionBorderTone: number; // 60 (dark) | 35 (light)

  // Ghost-option fg/icon — same pattern as ghost-action
  ghostOptionFgTone: number; // 100 (dark, uniform)
  ghostOptionFgI: number;    // 2 (dark, uniform)
  ghostOptionFgRestToneLight: number;  // fgMutedTone (light)
  ghostOptionFgHoverToneLight: number; // 15 (light)
  ghostOptionFgActiveToneLight: number;// 10 (light)
  ghostOptionFgRestILight: number;     // txtISubtle (light)
  ghostOptionFgHoverILight: number;    // 9 (light)
  ghostOptionFgActiveILight: number;   // 9 (light)
  ghostOptionIconRestToneLight: number;   // fgMutedTone (light)
  ghostOptionIconHoverToneLight: number;  // 22 (light)
  ghostOptionIconActiveToneLight: number; // 13 (light)
  ghostOptionIconActiveILight: number;    // 27 (light)
  ghostOptionBorderI: number;    // 20 (dark) | 10 (light)
  ghostOptionBorderTone: number; // 60 (dark) | 35 (light)

  // Outlined-option border tones (intensity uses txtISubtle in both modes)
  outlinedOptionBorderRestTone: number;   // 50 (dark) | fgMutedTone (light)
  outlinedOptionBorderHoverTone: number;  // 55 (dark) | fgMutedTone-3 (light)
  outlinedOptionBorderActiveTone: number; // 60 (dark) | fgMutedTone-6 (light)
}

/**
 * Dark-mode preset — parameter values reproduce the hand-authored Brio dark-mode
 * CSS exactly (verified by T-BRIO-MATCH). [D03]
 *
 * Contains hue slot fields (Spec S05), sentinel hue slot fields ([D07]),
 * per-tier intensity/tone overrides, formula parameters, and per-state
 * control emphasis fields ([D10]).
 */
export const DARK_PRESET: ModePreset = {
  isLight: false,

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
  surfaceDefaultI: 5, // = atmI
  surfaceRaisedI: 5,  // = atmI
  surfaceInsetI: 5,   // = atmI
  surfaceContentI: 5, // = atmI

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
  fgInverseI: 3,   // = txtI
  fgOnCautionI: 4,
  fgOnSuccessI: 4,

  // Border intensities
  borderIBase: 6,
  borderIStrong: 7,

  // Border/divider mode-dependent tones/intensities (dark)
  borderMutedTone: 37, // = fgSubtleTone
  borderMutedI: 7,     // = borderIStrong
  borderStrongTone: 40,

  // Divider intensity (dark)
  dividerDefaultI: 6,
  dividerMutedI: 4,

  // Card frame (original: --tug-color(indigo, i: 12, t: 18) active, i: 4, t: 15 inactive)
  cardFrameActiveI: 12,
  cardFrameActiveTone: 18,
  cardFrameInactiveI: 4,
  cardFrameInactiveTone: 15,

  // Tab bg hue slots (dark: cardFrame; light: atm)
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
  iconMutedI: 7,   // = txtISubtle
  iconMutedTone: 37, // = fgSubtleTone

  // Tab tone overrides (dark)
  tabFgActiveTone: 90,

  // Toggle tones (dark)
  toggleTrackOnHoverTone: 45,
  toggleThumbDisabledTone: 40,
  toggleTrackDisabledI: 5, // = atmI

  // Field tones (Brio dark ground truth)
  fieldBgRestTone: 8,
  fieldBgHoverTone: 11,
  fieldBgFocusTone: 7,
  fieldBgDisabledTone: 6,
  fieldBgReadOnlyTone: 11,

  // Field intensity (dark)
  fieldBgRestI: 5, // = atmI

  // Control disabled (dark)
  disabledBgI: 5,     // = atmI
  disabledBorderI: 6,

  // Formula parameter fields (dark)
  bgCanvasToneBase: 5,      // = bgAppTone; dark bg-canvas reuses bgApp formula
  bgCanvasToneSCCenter: 50, // same center as bgApp formula
  bgCanvasToneScale: 8,     // same scale as bgApp formula
  disabledBgBase: 22,       // dark disabled-bg is flat: 22 + (sc - 50)/50 * 0 = 22
  disabledBgScale: 0,       // flat (no sc scaling) in dark

  // Badge tinted emphasis formula parameters
  badgeTintedFgI: 72,
  badgeTintedFgTone: 85,
  badgeTintedBgI: 65,
  badgeTintedBgTone: 60,
  badgeTintedBgAlpha: 15,
  badgeTintedBorderI: 50,
  badgeTintedBorderTone: 50,
  badgeTintedBorderAlpha: 35,

  // -------------------------------------------------------------------------
  // Hue slot fields — surface tiers (dark)
  // -------------------------------------------------------------------------
  bgAppHueSlot: "canvas",
  bgCanvasHueSlot: "canvas",
  surfaceSunkenHueSlot: "surfBareBase",
  surfaceDefaultHueSlot: "surfBareBase",
  surfaceRaisedHueSlot: "atm",
  surfaceOverlayHueSlot: "surfBareBase",
  surfaceInsetHueSlot: "atm",
  surfaceContentHueSlot: "atm",
  surfaceScreenHueSlot: "surfScreen",

  // -------------------------------------------------------------------------
  // Hue slot fields — foreground tiers (dark)
  // -------------------------------------------------------------------------
  fgMutedHueSlot: "fgMuted",
  fgSubtleHueSlot: "fgSubtle",
  fgDisabledHueSlot: "fgDisabled",
  fgPlaceholderHueSlot: "fgPlaceholder",
  fgInverseHueSlot: "fgInverse",
  fgOnAccentHueSlot: "fgInverse",

  // -------------------------------------------------------------------------
  // Hue slot fields — icon tiers (dark)
  // -------------------------------------------------------------------------
  iconMutedHueSlot: "fgSubtle",
  iconOnAccentHueSlot: "fgInverse",

  // -------------------------------------------------------------------------
  // Hue slot fields — border/divider (dark)
  // -------------------------------------------------------------------------
  dividerMutedHueSlot: "borderTintBareBase",

  // -------------------------------------------------------------------------
  // Hue slot fields — control disabled (dark)
  // -------------------------------------------------------------------------
  disabledBgHueSlot: "surfBareBase",

  // -------------------------------------------------------------------------
  // Hue slot fields — field (dark)
  // -------------------------------------------------------------------------
  fieldBgHoverHueSlot: "surfBareBase",
  fieldBgReadOnlyHueSlot: "surfBareBase",
  fieldPlaceholderHueSlot: "fgPlaceholder",
  fieldBorderRestHueSlot: "fgPlaceholder",
  fieldBorderHoverHueSlot: "fgSubtle",

  // -------------------------------------------------------------------------
  // Hue slot fields — toggle (dark)
  // -------------------------------------------------------------------------
  toggleTrackDisabledHueSlot: "surfBareBase",
  toggleThumbHueSlot: "fgInverse",
  checkmarkHueSlot: "fgInverse",
  radioDotHueSlot: "fgInverse",

  // -------------------------------------------------------------------------
  // Sentinel hue slot fields (dark) [D07]
  // -------------------------------------------------------------------------
  outlinedBgHoverHueSlot: "__highlight",
  outlinedBgActiveHueSlot: "__highlight",
  ghostActionBgHoverHueSlot: "__highlight",
  ghostActionBgActiveHueSlot: "__highlight",
  ghostOptionBgHoverHueSlot: "__highlight",
  ghostOptionBgActiveHueSlot: "__highlight",
  tabBgHoverHueSlot: "__highlight",
  tabCloseBgHoverHueSlot: "__highlight",
  highlightHoverHueSlot: "__verboseHighlight",

  // -------------------------------------------------------------------------
  // Alpha values for sentinel-dispatched tokens (dark)
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Per-state control emphasis fields [D10] (dark)
  // Dark uses uniform values across all states (rest/hover/active identical):
  //   tone = 100 (filledFgTone), I = 2 (= Math.max(1, txtI-1) = Math.max(1, 3-1))
  // -------------------------------------------------------------------------
  outlinedFgTone: 100,
  outlinedFgI: 2,

  // Outlined-action fg/icon per-state light tones (dark values: not used; set to 0)
  outlinedActionFgRestToneLight: 0,
  outlinedActionFgHoverToneLight: 0,
  outlinedActionFgActiveToneLight: 0,
  outlinedActionIconRestToneLight: 0,
  outlinedActionIconHoverToneLight: 0,
  outlinedActionIconActiveToneLight: 0,

  // Outlined-agent fg/icon per-state light tones (dark: not used)
  outlinedAgentFgRestToneLight: 0,
  outlinedAgentFgHoverToneLight: 0,
  outlinedAgentFgActiveToneLight: 0,
  outlinedAgentIconRestToneLight: 0,
  outlinedAgentIconHoverToneLight: 0,
  outlinedAgentIconActiveToneLight: 0,

  // Outlined-option fg/icon per-state light tones (dark: not used)
  outlinedOptionFgRestToneLight: 0,
  outlinedOptionFgHoverToneLight: 0,
  outlinedOptionFgActiveToneLight: 0,
  outlinedOptionIconRestToneLight: 0,
  outlinedOptionIconHoverToneLight: 0,
  outlinedOptionIconActiveToneLight: 0,

  // Ghost-action fg/icon (dark: uniform across states)
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

  // Ghost-option fg/icon (dark: uniform across states)
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

  // Outlined-option border tones (dark)
  outlinedOptionBorderRestTone: 50,
  outlinedOptionBorderHoverTone: 55,
  outlinedOptionBorderActiveTone: 60,
};

/**
 * Light-mode preset — wraps the light-mode formula values.
 *
 * Contains hue slot fields (Spec S05), sentinel hue slot fields ([D07]),
 * per-tier intensity/tone overrides, formula parameters, and per-state
 * control emphasis fields ([D10]).
 */
export const LIGHT_PRESET: ModePreset = {
  isLight: true,

  // Surface tones (from Harmony, yellow atmosphere)
  bgAppTone: 20,
  bgCanvasTone: 20,
  surfaceSunkenTone: 44,
  surfaceDefaultTone: 99,
  surfaceRaisedTone: 24,
  surfaceOverlayTone: 48,
  surfaceInsetTone: 100,
  surfaceContentTone: 100,
  surfaceScreenTone: 80,

  // Surface intensities
  atmI: 5,
  surfaceOverlayI: 6,
  surfaceScreenI: 4,

  // Per-tier surface intensity overrides (light)
  bgAppI: 5,  // = atmI; bg-app light uses txt hue at atmI
  bgCanvasI: 7,
  surfaceDefaultI: 4,
  surfaceRaisedI: 5,
  surfaceInsetI: 4,
  surfaceContentI: 4,

  // Foreground tones (light mode, near-black text)
  fgDefaultTone: 13,
  fgMutedTone: 22,
  fgSubtleTone: 30,
  fgDisabledTone: 44,
  fgPlaceholderTone: 28,
  fgInverseTone: 100,

  // Text intensities
  txtI: 8,
  txtISubtle: 9,
  fgMutedI: 9, // = txtISubtle in light
  atmIBorder: 9,

  // Foreground intensity overrides (light)
  fgInverseI: 1,
  fgOnCautionI: 5, // = atmI
  fgOnSuccessI: 5, // = atmI

  // Border intensities
  borderIBase: 9,
  borderIStrong: 10,

  // Border/divider mode-dependent tones/intensities (light)
  borderMutedTone: 36,
  borderMutedI: 10,
  borderStrongTone: 24, // = fgSubtleTone(30) - 6

  // Divider intensity (light)
  dividerDefaultI: 5, // = atmI
  dividerMutedI: 5,   // = atmI

  // Card frame
  cardFrameActiveI: 4,
  cardFrameActiveTone: 92,
  cardFrameInactiveI: 2,
  cardFrameInactiveTone: 90,

  // Tab bg hue slots (light: atm)
  tabBgActiveHueSlot: "atm",
  tabBgInactiveHueSlot: "atm",

  // Shadow / overlay alphas (light mode — lower alpha)
  shadowXsAlpha: 8,
  shadowMdAlpha: 30,
  shadowLgAlpha: 36,
  shadowXlAlpha: 44,
  shadowOverlayAlpha: 24,
  overlayDimAlpha: 20,
  overlayScrimAlpha: 32,
  overlayHighlightAlpha: 50,

  // Control emphasis tones (light mode)
  filledBgDarkTone: 30,
  filledBgHoverTone: 40,
  filledBgActiveTone: 50,

  // Icon tone/intensity overrides (light)
  iconActiveTone: 22,
  iconMutedI: 9,   // = atmIBorder
  iconMutedTone: 28, // = fgPlaceholderTone

  // Tab tone overrides (light)
  tabFgActiveTone: 13, // = fgDefaultTone

  // Toggle tones (light)
  toggleTrackOnHoverTone: 40,
  toggleThumbDisabledTone: 44, // = fgDisabledTone
  toggleTrackDisabledI: 6,

  // Field tones (light mode)
  fieldBgRestTone: 51,
  fieldBgHoverTone: 74,
  fieldBgFocusTone: 99,
  fieldBgDisabledTone: 48,
  fieldBgReadOnlyTone: 74,

  // Field intensity (light)
  fieldBgRestI: 7,

  // Control disabled (light)
  disabledBgI: 6,
  disabledBorderI: 9, // = atmIBorder

  // Formula parameter fields (light)
  bgCanvasToneBase: 35,      // light bg-canvas uses independent formula anchored at 35
  bgCanvasToneSCCenter: 0,   // anchored at sc=0, scales with sc/100
  bgCanvasToneScale: 10,
  disabledBgBase: 70,        // light: 70 + (sc/100)*10
  disabledBgScale: 10,

  // Badge tinted emphasis formula parameters
  badgeTintedFgI: 72,
  badgeTintedFgTone: 85,
  badgeTintedBgI: 65,
  badgeTintedBgTone: 60,
  badgeTintedBgAlpha: 15,
  badgeTintedBorderI: 50,
  badgeTintedBorderTone: 50,
  badgeTintedBorderAlpha: 35,

  // -------------------------------------------------------------------------
  // Hue slot fields — surface tiers (light)
  // -------------------------------------------------------------------------
  bgAppHueSlot: "txt",
  bgCanvasHueSlot: "atm",
  surfaceSunkenHueSlot: "atm",
  surfaceDefaultHueSlot: "atm",
  surfaceRaisedHueSlot: "txt",
  surfaceOverlayHueSlot: "atm",
  surfaceInsetHueSlot: "atm",
  surfaceContentHueSlot: "atm",
  surfaceScreenHueSlot: "txt",

  // -------------------------------------------------------------------------
  // Hue slot fields — foreground tiers (light)
  // -------------------------------------------------------------------------
  fgMutedHueSlot: "txt",
  fgSubtleHueSlot: "txt",
  fgDisabledHueSlot: "txt",
  fgPlaceholderHueSlot: "atm",
  fgInverseHueSlot: "txt",
  fgOnAccentHueSlot: "__white",

  // -------------------------------------------------------------------------
  // Hue slot fields — icon tiers (light)
  // -------------------------------------------------------------------------
  iconMutedHueSlot: "atm",
  iconOnAccentHueSlot: "__white",

  // -------------------------------------------------------------------------
  // Hue slot fields — border/divider (light)
  // -------------------------------------------------------------------------
  dividerMutedHueSlot: "borderTint",

  // -------------------------------------------------------------------------
  // Hue slot fields — control disabled (light)
  // -------------------------------------------------------------------------
  disabledBgHueSlot: "atm",

  // -------------------------------------------------------------------------
  // Hue slot fields — field (light)
  // -------------------------------------------------------------------------
  fieldBgHoverHueSlot: "atm",
  fieldBgReadOnlyHueSlot: "atm",
  fieldPlaceholderHueSlot: "atm",
  fieldBorderRestHueSlot: "atm",
  fieldBorderHoverHueSlot: "borderStrong",

  // -------------------------------------------------------------------------
  // Hue slot fields — toggle (light)
  // -------------------------------------------------------------------------
  toggleTrackDisabledHueSlot: "atm",
  toggleThumbHueSlot: "__white",
  checkmarkHueSlot: "__white",
  radioDotHueSlot: "__white",

  // -------------------------------------------------------------------------
  // Sentinel hue slot fields (light) [D07]
  // -------------------------------------------------------------------------
  outlinedBgHoverHueSlot: "atm",
  outlinedBgActiveHueSlot: "atm",
  ghostActionBgHoverHueSlot: "__shadow",
  ghostActionBgActiveHueSlot: "__shadow",
  ghostOptionBgHoverHueSlot: "__shadow",
  ghostOptionBgActiveHueSlot: "__shadow",
  tabBgHoverHueSlot: "__shadow",
  tabCloseBgHoverHueSlot: "__shadow",
  highlightHoverHueSlot: "__shadow",

  // -------------------------------------------------------------------------
  // Alpha values for sentinel-dispatched tokens (light)
  // -------------------------------------------------------------------------
  tabBgHoverAlpha: 6,
  tabCloseBgHoverAlpha: 10,
  outlinedBgHoverAlpha: 0,  // unused in light (chromatic dispatch via "atm")
  outlinedBgActiveAlpha: 0, // unused in light (chromatic dispatch via "atm")
  ghostActionBgHoverAlpha: 6,
  ghostActionBgActiveAlpha: 12,
  ghostOptionBgHoverAlpha: 6,
  ghostOptionBgActiveAlpha: 12,
  highlightHoverAlpha: 4,
  ghostDangerBgHoverAlpha: 8,
  ghostDangerBgActiveAlpha: 15,

  // -------------------------------------------------------------------------
  // Per-state control emphasis fields [D10] (light)
  // Dark uniform values not used in light; set to 0.
  // Light has per-state variation in tones.
  // -------------------------------------------------------------------------
  outlinedFgTone: 0,  // not used in light (uses per-state fields below)
  outlinedFgI: 0,     // not used in light

  // Outlined-action fg/icon per-state light tones
  outlinedActionFgRestToneLight: 13,    // = fgDefaultTone
  outlinedActionFgHoverToneLight: 10,
  outlinedActionFgActiveToneLight: 8,
  outlinedActionIconRestToneLight: 22,  // = fgMutedTone
  outlinedActionIconHoverToneLight: 22,
  outlinedActionIconActiveToneLight: 13,

  // Outlined-agent fg/icon — same as outlined-action
  outlinedAgentFgRestToneLight: 13,
  outlinedAgentFgHoverToneLight: 10,
  outlinedAgentFgActiveToneLight: 8,
  outlinedAgentIconRestToneLight: 22,
  outlinedAgentIconHoverToneLight: 22,
  outlinedAgentIconActiveToneLight: 13,

  // Outlined-option fg/icon — same as outlined-action
  outlinedOptionFgRestToneLight: 13,
  outlinedOptionFgHoverToneLight: 10,
  outlinedOptionFgActiveToneLight: 8,
  outlinedOptionIconRestToneLight: 22,
  outlinedOptionIconHoverToneLight: 22,
  outlinedOptionIconActiveToneLight: 13,

  // Ghost-action fg/icon (dark uniform not used in light)
  ghostActionFgTone: 0,
  ghostActionFgI: 0,
  ghostActionFgRestToneLight: 22,  // = fgMutedTone
  ghostActionFgHoverToneLight: 15,
  ghostActionFgActiveToneLight: 10,
  ghostActionFgRestILight: 9,      // = txtISubtle
  ghostActionFgHoverILight: 9,
  ghostActionFgActiveILight: 9,
  ghostActionIconRestToneLight: 22,  // = fgMutedTone
  ghostActionIconHoverToneLight: 22,
  ghostActionIconActiveToneLight: 13,
  ghostActionIconActiveILight: 27,
  ghostActionBorderI: 10,
  ghostActionBorderTone: 35,

  // Ghost-option fg/icon — same pattern as ghost-action
  ghostOptionFgTone: 0,
  ghostOptionFgI: 0,
  ghostOptionFgRestToneLight: 22,  // = fgMutedTone
  ghostOptionFgHoverToneLight: 15,
  ghostOptionFgActiveToneLight: 10,
  ghostOptionFgRestILight: 9,      // = txtISubtle
  ghostOptionFgHoverILight: 9,
  ghostOptionFgActiveILight: 9,
  ghostOptionIconRestToneLight: 22,  // = fgMutedTone
  ghostOptionIconHoverToneLight: 22,
  ghostOptionIconActiveToneLight: 13,
  ghostOptionIconActiveILight: 27,
  ghostOptionBorderI: 10,
  ghostOptionBorderTone: 35,

  // Outlined-option border tones (light)
  outlinedOptionBorderRestTone: 22,   // = fgMutedTone
  outlinedOptionBorderHoverTone: 19,  // = fgMutedTone - 3
  outlinedOptionBorderActiveTone: 16, // = fgMutedTone - 6
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
 * @param recipe - The theme recipe
 * @param warmth - Warmth knob value (0-100, default 50)
 */
export function resolveHueSlots(recipe: ThemeRecipe, warmth: number): ResolvedHueSlots {
  const warmthBias = ((warmth - 50) / 50) * 12; // ±12° at extremes
  const isLight = recipe.mode === "light";

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

  // surfScreen: "indigo" in dark (cobalt+10 → indigo); txt in light.
  // The slot value is mode-dependent: dark uses fixed "indigo"; light uses the txt slot.
  // The preset's surfaceScreenHueSlot field ("surfScreen" in dark, "txt" in light) then
  // routes the rule evaluator to this slot, which already holds the correct value.
  const surfScreen: ResolvedHueSlot = isLight
    ? { ...txt }
    : (() => {
        const surfScreenHueDark = "indigo";
        const angle = applyWarmthBias(surfScreenHueDark, resolveHueAngle(surfScreenHueDark), warmthBias);
        return slotFromAngle(angle);
      })();

  // fgMuted: dark = bare primary of txtHue (e.g., "cobalt" from "indigo-cobalt").
  //          light = full txt slot.
  const fgMutedHueName = isLight ? txtHue : (() => {
    const primary = primaryColorName(txtHue);
    return primary in HUE_FAMILIES ? primary : txtHue;
  })();
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

  // fgSubtle: dark = "indigo-cobalt"; light = txt.
  const fgSubtleHueName = isLight ? txtHue : "indigo-cobalt";
  const fgSubtleAngle = applyWarmthBias(primaryColorName(fgSubtleHueName), resolveHueAngle(fgSubtleHueName), warmthBias);
  const fgSubtle = slotFromAngle(fgSubtleAngle);

  // fgDisabled: dark = "indigo-cobalt"; light = txt. (same as fgSubtle)
  const fgDisabledHueName = isLight ? txtHue : "indigo-cobalt";
  const fgDisabledAngle = applyWarmthBias(primaryColorName(fgDisabledHueName), resolveHueAngle(fgDisabledHueName), warmthBias);
  const fgDisabled = slotFromAngle(fgDisabledAngle);

  // fgInverse: dark = "sapphire-cobalt"; light = txt.
  const fgInverseHueName = isLight ? txtHue : "sapphire-cobalt";
  const fgInverseAngle = applyWarmthBias(primaryColorName(fgInverseHueName), resolveHueAngle(fgInverseHueName), warmthBias);
  const fgInverse = slotFromAngle(fgInverseAngle);

  // fgPlaceholder: dark = same as fgMuted (bare txt hue, e.g. cobalt).
  //               light = atm hue (atmosphere-colored placeholder per Harmony).
  const fgPlaceholder: ResolvedHueSlot = isLight ? { ...atm } : { ...fgMuted };

  // selectionInactive:
  //   dark = "yellow" (fixed hue, no warmth bias — Brio ground truth)
  //   light = atmBaseAngle - 20° with warmth bias applied
  const selectionInactive: ResolvedHueSlot = isLight
    ? (() => {
        const atmBaseAngle = resolveHueAngle(atmHue);
        const selAngle = applyWarmthBias(atmHue, (atmBaseAngle - 20 + 360) % 360, warmthBias);
        return slotFromAngle(selAngle);
      })()
    : resolveSemanticSlot("yellow"); // fixed yellow, no warmth bias in dark

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
 * All derived tone values, pre-computed from ModePreset + MoodKnobs before
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
 * Pre-compute all derived tone values from a ModePreset and MoodKnobs.
 *
 * This is Layer 2 of the three-layer derivation pipeline (Spec S01).
 * Called by deriveTheme() as Layer 2 of the pipeline. The output ComputedTones
 * is referenced by rule expressions in the RULES table (Layer 3).
 *
 * All formulas are verified against Brio dark-mode and Harmony light-mode
 * ground truth by T-TONES-DARK and T-TONES-LIGHT tests.
 *
 * Light-mode formula exceptions absorbed by preset fields (Spec S03):
 *   - bgCanvas: uses preset.bgCanvasToneBase/SCCenter/Scale for unified formula
 *   - disabledBgTone: uses preset.disabledBgBase/Scale
 *
 * @param preset - Mode-specific parameter bundle (DARK_PRESET or LIGHT_PRESET)
 * @param knobs - Normalized mood knob values
 */
export function computeTones(preset: ModePreset, knobs: MoodKnobs): ComputedTones {
  const sc = knobs.surfaceContrast;

  // ---------------------------------------------------------------------------
  // Surface tones — each anchored at preset tone at sc=50, scaled around it.
  // ---------------------------------------------------------------------------

  // bg-app: anchored at preset.bgAppTone at sc=50, ±8 units at extremes
  const bgApp = preset.bgAppTone + ((sc - 50) / 50) * 8;

  // bg-canvas: unified formula using preset fields (Spec S03 light-mode exception)
  //   Dark: bgCanvasToneBase=bgAppTone, bgCanvasToneSCCenter=50, bgCanvasToneScale=8
  //         -> Math.round(bgAppTone + ((sc - 50)/50) * 8) = Math.round(bgApp)
  //   Light: bgCanvasToneBase=35, bgCanvasToneSCCenter=0, bgCanvasToneScale=10
  //          -> Math.round(35 + (sc/100) * 10)
  const bgCanvas = Math.round(
    preset.bgCanvasToneBase +
      ((sc - preset.bgCanvasToneSCCenter) /
        (preset.bgCanvasToneSCCenter === 0 ? 100 : 50)) *
        preset.bgCanvasToneScale,
  );

  // surface-sunken: anchored at preset.surfaceSunkenTone at sc=50, ±5 units
  const surfaceSunken = Math.round(preset.surfaceSunkenTone + ((sc - 50) / 50) * 5);

  // surface-default: anchored at preset.surfaceDefaultTone at sc=50, ±3 units
  const surfaceDefault = Math.round(preset.surfaceDefaultTone + ((sc - 50) / 50) * 3);

  // surface-raised: anchored at preset.surfaceRaisedTone at sc=50, ±5 units
  const surfaceRaised = Math.round(preset.surfaceRaisedTone + ((sc - 50) / 50) * 5);

  // surface-overlay: anchored at preset.surfaceOverlayTone at sc=50, ±5 units
  const surfaceOverlay = Math.round(preset.surfaceOverlayTone + ((sc - 50) / 50) * 5);

  // surface-inset: anchored at preset.surfaceInsetTone at sc=50, ±7 units
  const surfaceInset = Math.round(preset.surfaceInsetTone + ((sc - 50) / 50) * 7);

  // surface-content: matches inset (code blocks, inline content areas)
  const surfaceContent = surfaceInset;

  // surface-screen: anchored at preset.surfaceScreenTone at sc=50, ±13 units
  const surfaceScreen = Math.round(preset.surfaceScreenTone + ((sc - 50) / 50) * 13);

  // ---------------------------------------------------------------------------
  // Divider tones — derived from surface overlay tone
  // Dark mode: flat Brio ground-truth values (17, 15)
  // Light mode: derived from surfaceOverlay (same as inline deriveTheme formula)
  // ---------------------------------------------------------------------------
  const dividerDefault = Math.round(
    !preset.isLight
      ? 17 // dark mode: flat Brio ground truth
      : surfaceOverlay - 2, // light mode: derived from overlay
  );
  const dividerMuted = Math.round(
    !preset.isLight
      ? 15 // dark mode: flat Brio ground truth
      : surfaceOverlay, // light mode: derived from overlay
  );
  const dividerTone = dividerDefault;

  // ---------------------------------------------------------------------------
  // Control/field derived tones
  // ---------------------------------------------------------------------------

  // disabled-bg: dark=flat 22; light=70+(sc/100)*10 (Spec S03 exception)
  const disabledBgTone = Math.round(
    preset.disabledBgBase + (sc / 100) * preset.disabledBgScale,
  );

  // disabled-fg: dark=38; light=fgDisabledTone (from preset)
  const disabledFgTone = !preset.isLight ? 38 : preset.fgDisabledTone;

  // disabled-border: dark=28; light=dividerTone
  const disabledBorderTone = !preset.isLight ? 28 : Math.round(dividerTone);

  // outlined bg tones (for light-mode chromatic outlined bg hover/active)
  // Dark: same as surface-inset+2 / surface-raised+1 / surface-overlay
  // Light: flat preset values (51, 99, 48 from Harmony)
  const outlinedBgRestTone = !preset.isLight ? Math.round(surfaceInset + 2) : 51;
  const outlinedBgHoverTone = !preset.isLight ? Math.round(surfaceRaised + 1) : 99;
  const outlinedBgActiveTone = !preset.isLight ? Math.round(surfaceOverlay) : 48;

  // toggle track off and disabled tones
  // Dark: flat 28/22; Light: derived from divider/overlay
  const toggleTrackOffTone = !preset.isLight ? 28 : Math.round(dividerTone);
  const toggleDisabledTone = !preset.isLight ? 22 : Math.round(surfaceOverlay);

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
 * Shared expression type: a function of (preset, knobs, computed) -> number.
 * Used for intensity, tone, and alpha fields in chromatic rules. Spec S04.
 */
export type Expr = (preset: ModePreset, knobs: MoodKnobs, computed: ComputedTones) => number;

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
    preset: ModePreset,
    knobs: MoodKnobs,
    computed: ComputedTones,
    resolvedSlots: ResolvedHueSlots,
  ) => string;
  resolvedExpr?: (
    preset: ModePreset,
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
 *   2. Otherwise read preset[hueSlot + "HueSlot"] to get the key.
 * Sentinel dispatch per [D07]:
 *   "__white"            → setChromatic-style white; fills resolved.
 *   "__highlight"        → compact white-a token; fills resolved.
 *   "__shadow"           → compact black-a token; fills resolved.
 *   "__verboseHighlight" → verbose white form with explicit i:0 t:100; fills resolved.
 *
 * @param rules         Named rule table (token name → DerivationRule)
 * @param resolvedSlots Output of resolveHueSlots()
 * @param preset        Active ModePreset (DARK_PRESET or LIGHT_PRESET)
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
  preset: ModePreset,
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
        const alpha = Math.round(rule.alphaExpr(preset, knobs, computed));
        tokens[tokenName] = makeShadow(alpha);
        resolved[tokenName] = { ...blackResolved, alpha: alpha / 100 };
        break;
      }

      case "highlight": {
        const alpha = Math.round(rule.alphaExpr(preset, knobs, computed));
        tokens[tokenName] = makeHighlight(alpha);
        resolved[tokenName] = { ...whiteResolved, alpha: alpha / 100 };
        break;
      }

      case "structural": {
        tokens[tokenName] = rule.valueExpr(preset, knobs, computed, resolvedSlots);
        if (rule.resolvedExpr) {
          resolved[tokenName] = rule.resolvedExpr(preset, knobs, computed);
        }
        break;
      }

      case "chromatic": {
        // Resolve the effective slot string via dual path [D09]
        let effectiveSlot: string;
        if (slotKeys.has(rule.hueSlot)) {
          effectiveSlot = rule.hueSlot; // direct key path
        } else {
          // Preset-mediated path: read preset[hueSlot + "HueSlot"]
          const presetKey = (rule.hueSlot + "HueSlot") as keyof ModePreset;
          effectiveSlot = (preset[presetKey] as string) ?? rule.hueSlot;
        }

        // Sentinel check [D07]
        if (effectiveSlot === "__white") {
          tokens[tokenName] = "--tug-color(white)";
          resolved[tokenName] = { ...whiteResolved };
          break;
        }
        if (effectiveSlot === "__highlight") {
          const alpha = Math.round((rule.alphaExpr ?? (() => 100))(preset, knobs, computed));
          tokens[tokenName] = makeHighlight(alpha);
          resolved[tokenName] = { ...whiteResolved, alpha: alpha / 100 };
          break;
        }
        if (effectiveSlot === "__shadow") {
          const alpha = Math.round((rule.alphaExpr ?? (() => 100))(preset, knobs, computed));
          tokens[tokenName] = makeShadow(alpha);
          resolved[tokenName] = { ...blackResolved, alpha: alpha / 100 };
          break;
        }
        if (effectiveSlot === "__verboseHighlight") {
          const alpha = Math.round((rule.alphaExpr ?? (() => 100))(preset, knobs, computed));
          tokens[tokenName] = makeVerboseHighlight(alpha);
          resolved[tokenName] = { ...whiteResolved, alpha: alpha / 100 };
          break;
        }

        // Chromatic resolution
        const slot = resolvedSlots[effectiveSlot as keyof ResolvedHueSlots];
        if (!slot) break; // unknown slot key — skip
        const i = Math.round(rule.intensityExpr(preset, knobs, computed));
        const t = Math.round(rule.toneExpr(preset, knobs, computed));
        const a = rule.alphaExpr ? Math.round(rule.alphaExpr(preset, knobs, computed)) : 100;
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
 *   Layer 1 — resolveHueSlots(): recipe + warmth -> ResolvedHueSlots
 *   Layer 2 — computeTones():    preset + knobs  -> ComputedTones
 *   Layer 3 — evaluateRules():   RULES table     -> tokens + resolved maps
 */
export function deriveTheme(recipe: ThemeRecipe): ThemeOutput {
  // -------------------------------------------------------------------------
  // 1. Select mode preset [D03]
  // -------------------------------------------------------------------------
  const preset = recipe.mode === "light" ? LIGHT_PRESET : DARK_PRESET;

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
  const resolvedSlots = resolveHueSlots(recipe, warmth);

  // -------------------------------------------------------------------------
  // 4. Layer 2 — pre-compute derived tone values (Spec S03)
  // -------------------------------------------------------------------------
  const computedTones = computeTones(preset, knobs);
  const tokens: Record<string, string> = {};
  const resolved: Record<string, ResolvedColor> = {};

  // =========================================================================
  // 5. Layer 3 — evaluate rule table to produce all tokens
  // =========================================================================
  evaluateRules(
    RULES,
    resolvedSlots,
    preset,
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
