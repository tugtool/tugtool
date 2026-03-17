/**
 * Theme Derivation Engine — Tugways Theme Generator
 *
 * Derives complete 350-token `--tug-base-*` themes from a compact `ThemeRecipe`.
 * Each call to `deriveTheme()` returns:
 *   - `tokens`: all 349 token values as `--tug-color()` strings (for CSS export)
 *   - `resolved`: OKLCH values for all chromatic tokens (for contrast checking / CVD)
 *
 * The derivation follows ~55 role formulas extracted from the three hand-authored
 * themes (Brio, Bluenote, Harmony). Mood knobs (`surfaceContrast`, `signalIntensity`,
 * `warmth`) modulate tone spreads and intensity levels.
 *
 * Control tokens use the emphasis x role system (Table T01):
 *   13 combinations × 4 properties × 3 states = 156 emphasis-role control tokens
 *   (11 original combinations + 2 new: outlined-option, ghost-option)
 *   Plus 1 surface-control alias = 157 control tokens total
 *   (replaces old 4-variant system: 48 tokens + 3 disabled aliases = 51 tokens)
 *   Net change: +106 tokens (157 - 51)
 *
 * [D01] Export format — tokens map matches tug-base.css override structure
 * [D02] Emphasis x role token naming: --tug-base-control-{emphasis}-{role}-{property}-{state}
 * [D04] ThemeRecipe interface from proposal
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
 * `deriveTheme()` selects a preset by `recipe.mode` and uses its values instead
 * of inline `isLight ? X : Y` ternaries for numeric parameters, hue slot
 * assignments, and sentinel values for structural dispatch.
 *
 * Step 2 adds hue slot fields (Spec S05), sentinel hue slot fields ([D07]),
 * per-tier intensity/tone overrides, formula parameter fields, and per-state
 * control emphasis fields ([D10]) to absorb all 81 `isLight` branches.
 * The existing `isLight` branches in `deriveTheme()` remain unchanged in
 * this step — they will be eliminated in later steps once resolveHueSlots()
 * and the rule evaluation loop are in place.
 *
 * Sentinel values for hue slot fields ([D07]):
 *   "__white"            → setWhite()
 *   "__highlight"        → setHighlight(alphaExpr)
 *   "__shadow"           → setShadow(alphaExpr)
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
  // Icon tone overrides (Spec S05)
  // -------------------------------------------------------------------------
  iconActiveTone: number; // 80 (dark) | 22 (light)

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
 * Extended in Step 2 with hue slot fields (Spec S05), sentinel hue slot fields
 * ([D07]), per-tier intensity/tone overrides, formula parameters, and per-state
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

  // Icon tone overrides (dark)
  iconActiveTone: 80,

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
 * Light-mode preset — wraps the current light-mode formula values.
 * Formula accuracy against a hand-authored light-mode ground truth is deferred (Q01).
 *
 * Extended in Step 2 with hue slot fields (Spec S05), sentinel hue slot fields
 * ([D07]), per-tier intensity/tone overrides, formula parameters, and per-state
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

  // Icon tone overrides (light)
  iconActiveTone: 22,

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
 * and refs used in token derivation — replacing the ~22 inline hue variables
 * currently scattered through deriveTheme().
 *
 * Called in deriveTheme() in parallel with existing inline variables (Step 3).
 * In later steps, the inline variables will be removed and rules will reference
 * ResolvedHueSlots directly.
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

  // fgPlaceholder: same as fgMuted in both modes.
  const fgPlaceholder: ResolvedHueSlot = { ...fgMuted };

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
 * Called in deriveTheme() in parallel with existing inline tone computations
 * (Step 4). In later steps, the inline tone computations will be removed
 * and rules will reference ComputedTones directly.
 *
 * All formulas match the inline computations currently in deriveTheme()
 * exactly, verified by T-TONES-DARK and T-TONES-LIGHT tests.
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
 *   - `contrastResults` / `cvdWarnings`: empty arrays (populated in Step 3/5)
 *
 * Role formulas are extracted from Brio (tug-base.css). Each formula maps
 * (atmosphere, text, accent, active, semantic seeds + mood knobs + mode)
 * to a specific token value.
 *
 * Step 2: adds 4 new tone families (accent, active, agent, data — 20 tokens) and
 * removes the info family (5 tokens). Count after Step 2: ~238.
 * Step 3: removes accent-muted (1 token, unused per audit).
 * Count after Step 3: 237.
 */
export function deriveTheme(recipe: ThemeRecipe): ThemeOutput {
  // -------------------------------------------------------------------------
  // 1. Resolve seed hue angles
  // -------------------------------------------------------------------------
  const atmHue = recipe.cardBg.hue;
  const atmAngle = resolveHueAngle(atmHue);

  const txtHue = recipe.text.hue;
  const txtAngle = resolveHueAngle(txtHue);

  const accentHue = recipe.accent ?? "orange";
  const accentAngle = resolveHueAngle(accentHue);
  const accentName = closestHueName(accentAngle);

  const activeHue = recipe.active ?? "blue";
  const activeAngle = resolveHueAngle(activeHue);
  const activeName = closestHueName(activeAngle);
  const activeRef = formatHueRef(activeName, activeAngle);

  // [D05] Link hue: used for fg-link, fg-link-hover, selection, highlight, and field-border-active.
  // Defaults to active hue when not specified.
  const interactiveHue = recipe.link ?? recipe.active ?? "blue";
  const interactiveAngle = resolveHueAngle(interactiveHue);
  const interactiveName = closestHueName(interactiveAngle);
  const interactiveRef = formatHueRef(interactiveName, interactiveAngle);

  // Canvas hue: used for bg-canvas, bg-app. Defaults to cardBg hue.
  const canvasHue = recipe.canvas ?? atmHue;
  const canvasAngle = resolveHueAngle(canvasHue);

  // CardFrame hue: used for card title bar, tab bar bg. Defaults to "indigo".
  const cardFrameHue = recipe.cardFrame ?? "indigo";
  const cardFrameAngle = resolveHueAngle(cardFrameHue);

  // BorderTint hue: used for border-default/muted/strong, dividers. Defaults to cardBg hue.
  const borderTintHue = recipe.borderTint ?? atmHue;
  const borderTintAngle = resolveHueAngle(borderTintHue);

  const destructiveHue = recipe.destructive ?? "red";
  const successHue = recipe.success ?? "green";
  const cautionHue = recipe.caution ?? "yellow";
  const agentHue = recipe.agent ?? "violet";
  const dataHue = recipe.data ?? "teal";

  const isLight = recipe.mode === "light";

  // Select mode preset: DARK_PRESET for dark mode, LIGHT_PRESET for light mode. [D03]
  // Numeric formula parameters (tone anchors, intensity levels, alpha values) are
  // read from the preset. Hue-selection logic and structural code paths remain as
  // `isLight` branches.
  const preset = isLight ? LIGHT_PRESET : DARK_PRESET;

  // -------------------------------------------------------------------------
  // 2. Mood knob normalization (0-100, default 50)
  // -------------------------------------------------------------------------
  const surfaceContrast = recipe.surfaceContrast ?? 50;
  const signalIntensity = recipe.signalIntensity ?? 50;
  const warmth = recipe.warmth ?? 50;

  // Warmth hue bias: ±12° at extremes applied to achromatic-adjacent hues.
  // Module-scope ACHROMATIC_ADJACENT_HUES, primaryColorName(), and applyWarmthBias()
  // are used directly. Local wrappers below maintain the existing 2-arg call signature
  // used throughout deriveTheme() body (warmthBias is bound from the closure).
  const warmthBias = ((warmth - 50) / 50) * 12; // ±12° at extremes

  // Local wrapper: 2-arg version with warmthBias bound from closure.
  // Preserves the calling convention used throughout the deriveTheme() body.
  // The module-scope applyWarmthBias(hueName, angle, warmthBias) is the canonical form.
  function applyWarmthBias(hueName: string, angle: number): number {
    const primary = primaryColorName(hueName);
    if (!ACHROMATIC_ADJACENT_HUES.has(primary)) return angle;
    return (angle + warmthBias + 360) % 360;
  }

  // Layer 1: resolve all hue slots for this recipe (parallel to existing inline vars).
  // In later steps, inline hue variables will be replaced by resolvedSlots references.
  const resolvedSlots = resolveHueSlots(recipe, warmth);

  // Layer 2: pre-compute all derived tones (parallel to existing inline computations).
  // In later steps, rules will reference computedTones directly instead of inline vars.
  const computedTones = computeTones(preset, { surfaceContrast, signalIntensity, warmth });

  // Atmosphere angle with warmth bias applied (for neutral/achromatic hues)
  const atmAngleW = applyWarmthBias(atmHue, atmAngle);
  const atmNameW = closestHueName(atmAngleW);
  const atmPrimaryNameW = primaryColorName(atmNameW);
  const atmRefW = formatHueRef(atmNameW, atmAngleW);

  // Text angle with warmth bias applied
  const txtAngleW = applyWarmthBias(txtHue, txtAngle);
  const txtNameW = closestHueName(txtAngleW);
  const txtPrimaryNameW = primaryColorName(txtNameW);
  const txtRefW = formatHueRef(txtNameW, txtAngleW);

  // Canvas angle with warmth bias applied (defaults to atm)
  const canvasAngleW = applyWarmthBias(canvasHue, canvasAngle);
  const canvasNameW = closestHueName(canvasAngleW);
  const canvasRefW = formatHueRef(canvasNameW, canvasAngleW);

  // CardFrame angle with warmth bias applied (defaults to "indigo")
  const cardFrameAngleW = applyWarmthBias(cardFrameHue, cardFrameAngle);
  const cardFrameNameW = closestHueName(cardFrameAngleW);
  const cardFrameRefW = formatHueRef(cardFrameNameW, cardFrameAngleW);

  // BorderTint angle with warmth bias applied (defaults to atm)
  const borderTintAngleW = applyWarmthBias(borderTintHue, borderTintAngle);
  const borderTintNameW = closestHueName(borderTintAngleW);
  const borderTintRefW = formatHueRef(borderTintNameW, borderTintAngleW);

  // Base hue angles — the primary named angle used for per-tier hue derivation.
  // For hyphenated names (e.g. "indigo-violet"), use the resolved hyphenated angle
  // as the base for per-tier computations (warmth bias is applied per-tier).
  const atmBaseAngle = atmAngle;
  const txtBaseAngle = txtAngle;

  // -------------------------------------------------------------------------
  // 3. Derive surface/tone spread parameters from surfaceContrast and mode
  //
  // Dark mode surface tones — Brio ground truth (surfaceContrast=50):
  //   bg-app=5, bg-canvas=5, sunken=11, default=12, raised=11, overlay=14,
  //   inset=6, content=6, screen=16
  //
  // Light mode: surface tones extracted from Harmony (yellow atm):
  //   bg-app=20, sunken=44, default=99, raised=24, overlay=48, inset=100,
  //   content=100, screen=80
  // -------------------------------------------------------------------------

  // Surface tone anchors from preset (at surfaceContrast=50). Formula scales
  // around the anchor for other surfaceContrast values.
  // Dark: DARK_PRESET values reproduce Brio ground truth at sc=50.
  // Light: LIGHT_PRESET values reproduce Harmony at sc=50.
  const darkBgApp = preset.bgAppTone + ((surfaceContrast - 50) / 50) * 8;

  // bg-canvas: same as bg-app in Brio (both use violet-6, i:2, t:5)
  const darkBgCanvas = Math.round(darkBgApp);

  // sunken: anchored to preset.surfaceSunkenTone at sc=50
  const darkSurfaceSunken = Math.round(preset.surfaceSunkenTone + ((surfaceContrast - 50) / 50) * 5);

  // default: anchored to preset.surfaceDefaultTone at sc=50
  const darkSurfaceDefault = Math.round(preset.surfaceDefaultTone + ((surfaceContrast - 50) / 50) * 3);

  // raised: anchored to preset.surfaceRaisedTone at sc=50
  const darkSurfaceRaised = Math.round(preset.surfaceRaisedTone + ((surfaceContrast - 50) / 50) * 5);

  // overlay: anchored to preset.surfaceOverlayTone at sc=50
  const darkSurfaceOverlay = Math.round(preset.surfaceOverlayTone + ((surfaceContrast - 50) / 50) * 5);

  // inset: anchored to preset.surfaceInsetTone at sc=50
  const darkSurfaceInset = Math.round(preset.surfaceInsetTone + ((surfaceContrast - 50) / 50) * 7);

  // content: matches inset (code blocks, inline content areas)
  const darkSurfaceContent = darkSurfaceInset;

  // screen: anchored to preset.surfaceScreenTone at sc=50
  const darkSurfaceScreen = Math.round(preset.surfaceScreenTone + ((surfaceContrast - 50) / 50) * 13);

  // -------------------------------------------------------------------------
  // 3a. Per-tier hue angle derivation for surface tokens (dark mode).
  //
  // Brio ground truth per-tier hue refs (atmosphere = indigo-violet = 263.3°):
  //   bg-app/canvas: indigo-violet (= recipe atm angle = atmAngleW)
  //   surface-sunken/default: violet (= bare base atm hue, no offset)
  //   surface-raised/inset/content: indigo-violet (= recipe atm angle = atmAngleW)
  //   surface-overlay: violet (= bare base atm hue, no offset)
  //   surface-screen: indigo (= cobalt+10 mapped to "indigo" at 260°)
  //
  // For the "bare atm base" tiers, we use the primary hue from the recipe.
  // For hyphenated names like "indigo-violet", the primary is "indigo" and
  // the bare base is "indigo" (the dominant color at 260°). However, the
  // Brio ground truth uses bare "violet" (270°) for these tiers.
  // We preserve the Brio pattern: bare-base tiers use the last segment of the
  // atmosphere hue (the recessive color) which is "violet" in "indigo-violet".
  // -------------------------------------------------------------------------

  // Extract the "bare base" hue name for surface tiers.
  // For bare names ("violet"), bare base = "violet".
  // For hyphenated names ("indigo-violet"), bare base = last segment = "violet".
  const atmBareBaseName = (() => {
    const hyphenIdx = atmHue.lastIndexOf("-");
    if (hyphenIdx > 0) {
      const lastSeg = atmHue.slice(hyphenIdx + 1);
      if (lastSeg in HUE_FAMILIES) return lastSeg;
    }
    // For bare names, use the name itself (maps through closestHueName at base angle)
    return closestHueName(atmBaseAngle);
  })();
  const surfBareBaseAngle = applyWarmthBias(atmBareBaseName, HUE_FAMILIES[atmBareBaseName] ?? atmBaseAngle);
  const surfBareBaseName = closestHueName(surfBareBaseAngle);
  const surfBareBaseRef = atmBareBaseName; // direct named reference

  // Dark mode: screen uses "indigo" (= cobalt+10 at 260° maps to "indigo" at 260°)
  const surfScreenHueDark = "indigo"; // per migration mapping: cobalt+10 → indigo (260°)
  const surfScreenAngleDark = applyWarmthBias(surfScreenHueDark, resolveHueAngle(surfScreenHueDark));
  const surfScreenNameDark = closestHueName(surfScreenAngleDark);
  const surfScreenRefDark = formatHueRef(surfScreenNameDark, surfScreenAngleDark);

  // -------------------------------------------------------------------------
  // 3b. Per-tier hue angle derivation for foreground tokens.
  //
  // Brio dark-mode ground truth (cobalt txtBase, no recipe offset):
  //   fg-default:     cobalt (bare hue)
  //   fg-muted:       cobalt (bare hue) — same bare hue, higher tone
  //   fg-subtle:      indigo-cobalt (cobalt+7 → 257° → "indigo-cobalt" at 256.7°)
  //   fg-disabled:    indigo-cobalt (cobalt+8 → 258° → "indigo-cobalt" at 256.7°)
  //   fg-placeholder: cobalt (bare hue)
  //   fg-inverse:     sapphire-cobalt (cobalt-8 → 242° → "sapphire-cobalt" at 243.3°)
  //
  // Light mode: all tiers use bare txtBase hue (no per-tier offsets).
  // -------------------------------------------------------------------------
  const fgDefaultAngleT = txtAngleW; // always uses full recipe txt angle
  const fgDefaultNameT = txtNameW;
  const fgDefaultRefT = txtRefW;

  // Dark mode: fg-muted uses bare txt hue (cobalt for Brio)
  const fgMutedHue = isLight ? txtHue : (() => {
    // Extract the primary base name from txtHue for the "bare" tier
    const primary = primaryColorName(txtHue);
    return primary in HUE_FAMILIES ? primary : txtHue;
  })();
  const fgMutedAngle = applyWarmthBias(fgMutedHue, resolveHueAngle(fgMutedHue));
  const fgMutedName = closestHueName(fgMutedAngle);
  const fgMutedPrimaryName = primaryColorName(fgMutedName);
  const fgMutedRef = fgMutedHue in HUE_FAMILIES ? fgMutedHue : fgMutedName;

  // Dark mode: fg-subtle uses indigo-cobalt (cobalt+7 → indigo-cobalt)
  const fgSubtleHue = isLight ? txtHue : "indigo-cobalt"; // per migration mapping
  const fgSubtleAngle = applyWarmthBias(primaryColorName(fgSubtleHue), resolveHueAngle(fgSubtleHue));
  const fgSubtleName = closestHueName(fgSubtleAngle);
  const fgSubtlePrimaryName = primaryColorName(fgSubtleName);
  const fgSubtleRef = formatHueRef(fgSubtleName, fgSubtleAngle);

  // Dark mode: fg-disabled uses indigo-cobalt (cobalt+8 → indigo-cobalt)
  const fgDisabledHue = isLight ? txtHue : "indigo-cobalt"; // per migration mapping
  const fgDisabledAngle = applyWarmthBias(primaryColorName(fgDisabledHue), resolveHueAngle(fgDisabledHue));
  const fgDisabledName = closestHueName(fgDisabledAngle);
  const fgDisabledPrimaryName = primaryColorName(fgDisabledName);
  const fgDisabledRef = formatHueRef(fgDisabledName, fgDisabledAngle);

  // Dark mode: fg-placeholder uses bare txt hue (cobalt for Brio)
  const fgPlaceholderAngle = fgMutedAngle;
  const fgPlaceholderName = fgMutedName;
  const fgPlaceholderPrimaryName = fgMutedPrimaryName;
  const fgPlaceholderRef = fgMutedRef;

  // Dark mode: fg-inverse uses sapphire-cobalt (cobalt-8 → sapphire-cobalt)
  const fgInverseHue = isLight ? txtHue : "sapphire-cobalt"; // per migration mapping
  const fgInverseAngle = applyWarmthBias(primaryColorName(fgInverseHue), resolveHueAngle(fgInverseHue));
  const fgInverseName = closestHueName(fgInverseAngle);
  const fgInversePrimaryName = primaryColorName(fgInverseName);
  const fgInverseRef = formatHueRef(fgInverseName, fgInverseAngle);

  // Atmosphere intensity (low for surfaces — subdued, muted). From preset. [D03]
  const atmI = preset.atmI;
  // Slightly higher intensity for some overlays. From preset. [D03]
  const atmIBorder = preset.atmIBorder;

  // -------------------------------------------------------------------------
  // 4. Derive text tone anchors from mode preset. [D03]
  // Dark mode: fg at tone 94 (Brio ground truth), grading down toward muted/subtle/disabled
  // Light mode: fg at tone ~13 (near-black), grading up toward muted/subtle/disabled
  // -------------------------------------------------------------------------
  // Foreground tones from preset (Brio ground truth for dark; Harmony for light)
  const fgDefaultTone = preset.fgDefaultTone;
  const fgMutedTone = preset.fgMutedTone;
  const fgSubtleTone = preset.fgSubtleTone;
  const fgDisabledTone = preset.fgDisabledTone;
  const fgPlaceholderTone = preset.fgPlaceholderTone;

  // Text intensity levels from preset. [D03]
  const txtI = preset.txtI;
  const txtISubtle = preset.txtISubtle;
  // fg-muted intensity from preset (Brio dark: 5; distinct from txtI=3 and txtISubtle=7)
  const fgMutedI = preset.fgMutedI;
  // fg-placeholder intensity: from preset.atmIBorder (same field in both presets)
  const fgPlaceholderI = preset.atmIBorder;

  // -------------------------------------------------------------------------
  // 5. Signal intensity modulation for accent / semantic hues
  // At signalIntensity=50 → intensity=50 (canonical). Direct linear mapping:
  //   0 → 0 (achromatic/invisible), 50 → 50 (Brio default), 100 → 100 (vivid)
  // -------------------------------------------------------------------------
  const signalI = Math.round(signalIntensity);

  // -------------------------------------------------------------------------
  // 6. Derive all 264 tokens
  // -------------------------------------------------------------------------
  const tokens: Record<string, string> = {};
  const resolved: Record<string, ResolvedColor> = {};

  /** Set a chromatic token and compute its resolved value. */
  function setChromatic(
    name: string,
    hueRef: string,
    hueAngle: number,
    i: number,
    t: number,
    a = 100,
    hueName?: string,
  ): void {
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
  }

  /** Set a shadow/overlay token (black-based). */
  function setShadow(name: string, alpha: number): void {
    tokens[name] = makeShadowToken(alpha);
    resolved[name] = { ...BLACK_RESOLVED, alpha: alpha / 100 };
  }

  /** Set a highlight token (white-based). */
  function setHighlight(name: string, alpha: number): void {
    tokens[name] = makeHighlightToken(alpha);
    resolved[name] = { ...WHITE_RESOLVED, alpha: alpha / 100 };
  }

  /** Set an achromatic white token (fully opaque). */
  function setWhite(name: string): void {
    tokens[name] = WHITE_TOKEN;
    resolved[name] = { ...WHITE_RESOLVED };
  }

  /** Set a structural (non-chromatic, non-invariant) token. */
  function setStructural(name: string, value: string): void {
    tokens[name] = value;
    // Structural tokens are absent from resolved map per [D09]
  }

  /** Set a theme-invariant token (pass-through from Brio). */
  function setInvariant(name: string, value: string): void {
    tokens[name] = value;
    // Invariant tokens are absent from resolved map per [D09]
  }

  // =========================================================================
  // A. Core Visual
  // =========================================================================

  // --- Surfaces ---
  // atmosphere hue drives all surfaces; tone levels from mode + surfaceContrast.
  // Dark mode uses Brio-matched hue refs per surface tier (violet-6/violet/cobalt+10).
  // Light mode uses atmRefW (atmosphere hue with warmth bias) for atmosphere-colored surfaces.

  // bg-app:
  //   Dark mode: Brio uses violet-6 (= canvasRefW/atmRefW), i:2, t:5.
  //   Light mode: Harmony uses TEXT hue (blue+5) for bg-app, not atmosphere (yellow).
  if (isLight) {
    setChromatic("--tug-base-bg-app", txtRefW, txtAngleW, atmI, Math.round(darkBgApp), 100, txtNameW);
  } else {
    setChromatic("--tug-base-bg-app", canvasRefW, canvasAngleW, 2, Math.round(darkBgApp), 100, canvasNameW);
  }

  // bg-canvas: Brio uses violet-6 (= canvasRefW/atmRefW), i:2, t:5 (same as bg-app).
  const bgCanvasTone = isLight ? Math.round(35 + (surfaceContrast / 100) * 10) : Math.round(darkBgCanvas);
  if (isLight) {
    setChromatic("--tug-base-bg-canvas", atmRefW, atmAngleW, 7, Math.round(bgCanvasTone), 100, atmNameW);
  } else {
    setChromatic("--tug-base-bg-canvas", canvasRefW, canvasAngleW, 2, Math.round(bgCanvasTone), 100, canvasNameW);
  }

  // surface-sunken: Brio uses bare violet (offset=0), i:5, t:11.
  if (isLight) {
    setChromatic("--tug-base-surface-sunken", atmRefW, atmAngleW, atmI, Math.round(darkSurfaceSunken), 100, atmNameW);
  } else {
    setChromatic("--tug-base-surface-sunken", surfBareBaseRef, surfBareBaseAngle, atmI, Math.round(darkSurfaceSunken), 100, surfBareBaseName);
  }

  // surface-default: Brio uses bare violet (offset=0), i:5, t:12.
  if (isLight) {
    setChromatic("--tug-base-surface-default", atmRefW, atmAngleW, 4, Math.round(darkSurfaceDefault), 100, atmNameW);
  } else {
    setChromatic("--tug-base-surface-default", surfBareBaseRef, surfBareBaseAngle, atmI, Math.round(darkSurfaceDefault), 100, surfBareBaseName);
  }

  // surface-raised: Brio uses violet-6 (= atmRefW), i:5, t:11.
  //   Light mode: Harmony uses text hue (blue t=24).
  if (isLight) {
    setChromatic("--tug-base-surface-raised", txtRefW, txtAngleW, 5, Math.round(darkSurfaceRaised), 100, txtNameW);
  } else {
    setChromatic("--tug-base-surface-raised", atmRefW, atmAngleW, atmI, Math.round(darkSurfaceRaised), 100, atmNameW);
  }

  // surface-overlay: Brio uses bare violet (offset=0), i:4, t:14.
  if (isLight) {
    setChromatic("--tug-base-surface-overlay", atmRefW, atmAngleW, 6, Math.round(darkSurfaceOverlay), 100, atmNameW);
  } else {
    setChromatic("--tug-base-surface-overlay", surfBareBaseRef, surfBareBaseAngle, 4, Math.round(darkSurfaceOverlay), 100, surfBareBaseName);
  }

  // surface-inset: Brio uses violet-6 (= atmRefW), i:5, t:6.
  if (isLight) {
    setChromatic("--tug-base-surface-inset", atmRefW, atmAngleW, 4, Math.round(darkSurfaceInset), 100, atmNameW);
  } else {
    setChromatic("--tug-base-surface-inset", atmRefW, atmAngleW, atmI, Math.round(darkSurfaceInset), 100, atmNameW);
  }

  // surface-content: Brio uses violet-6 (= atmRefW), i:5, t:6 (same as inset).
  if (isLight) {
    setChromatic("--tug-base-surface-content", atmRefW, atmAngleW, 4, Math.round(darkSurfaceContent), 100, atmNameW);
  } else {
    setChromatic("--tug-base-surface-content", atmRefW, atmAngleW, atmI, Math.round(darkSurfaceContent), 100, atmNameW);
  }

  // surface-screen: Brio uses cobalt+10 (= txtBaseAngle+10), i:7, t:16.
  //   Light mode: Harmony uses text hue (blue t=80).
  if (isLight) {
    setChromatic("--tug-base-surface-screen", txtRefW, txtAngleW, 4, Math.round(darkSurfaceScreen), 100, txtNameW);
  } else {
    setChromatic("--tug-base-surface-screen", surfScreenRefDark, surfScreenAngleDark, txtISubtle, Math.round(darkSurfaceScreen), 100, surfScreenNameDark);
  }

  // --- Foreground / Text ---
  // text hue drives all foreground tokens; tone from mode.
  // Per-tier hue angles are used for muted/subtle/placeholder tokens — they sample
  // slightly different positions along the hue spectrum (e.g. Bluenote fg-muted=blue+6,
  // fg-subtle=blue+7, fg-placeholder=blue+8). Light mode collapses these to the base hue.

  setChromatic("--tug-base-fg-default", fgDefaultRefT, fgDefaultAngleT, txtI, fgDefaultTone, 100, fgDefaultNameT);
  setChromatic("--tug-base-fg-muted", fgMutedRef, fgMutedAngle, fgMutedI, fgMutedTone, 100, fgMutedPrimaryName);
  setChromatic("--tug-base-fg-subtle", fgSubtleRef, fgSubtleAngle, txtISubtle, fgSubtleTone, 100, fgSubtlePrimaryName);
  // fg-disabled: Brio uses cobalt+8, i:7, t:23
  setChromatic("--tug-base-fg-disabled", fgDisabledRef, fgDisabledAngle, txtISubtle, fgDisabledTone, 100, fgDisabledPrimaryName);

  // fg-inverse: Brio uses cobalt-8, i:3, t:100
  const fgInverseTone = 100;
  const fgInverseI = isLight ? 1 : txtI;
  setChromatic("--tug-base-fg-inverse", isLight ? txtRefW : fgInverseRef, isLight ? txtAngleW : fgInverseAngle, fgInverseI, fgInverseTone, 100, isLight ? txtNameW : fgInversePrimaryName);

  // fg-placeholder: Brio uses bare cobalt (offset=0), i:6, t:30
  if (isLight) {
    setChromatic("--tug-base-fg-placeholder", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
  } else {
    setChromatic("--tug-base-fg-placeholder", fgPlaceholderRef, fgPlaceholderAngle, fgPlaceholderI, fgPlaceholderTone, 100, fgPlaceholderPrimaryName);
  }

  // fg-link: [D05] use interactiveHue (cyan for Brio) at canonical i:50, t:50 → "cyan"
  setChromatic("--tug-base-fg-link", interactiveRef, interactiveAngle, 50, 50, 100, interactiveName);
  // fg-link-hover: [D05] use interactiveHue at i:20, t:85 → "cyan-light" preset
  setChromatic("--tug-base-fg-link-hover", interactiveRef, interactiveAngle, 20, 85, 100, interactiveName);

  // fg-onAccent/onDanger: Brio uses cobalt-8, i:3, t:100 (same as fg-inverse in dark mode)
  if (isLight) {
    setWhite("--tug-base-fg-onAccent");
    setWhite("--tug-base-fg-onDanger");
  } else {
    setChromatic("--tug-base-fg-onAccent", fgInverseRef, fgInverseAngle, txtI, fgInverseTone, 100, fgInversePrimaryName);
    setChromatic("--tug-base-fg-onDanger", fgInverseRef, fgInverseAngle, txtI, fgInverseTone, 100, fgInversePrimaryName);
  }

  // fg-onCaution: Brio uses violet-6, i:4, t:7 (dark text on bright caution/success bg)
  setChromatic("--tug-base-fg-onCaution", atmRefW, atmAngleW, isLight ? atmI : 4, Math.round(isLight ? 7 : 7), 100, atmNameW);
  setChromatic("--tug-base-fg-onSuccess", atmRefW, atmAngleW, isLight ? atmI : 4, Math.round(isLight ? 7 : 7), 100, atmNameW);

  // --- Icon ---
  // Icons follow fg formulas: icon-default=fg-muted, icon-muted=fg-subtle, icon-disabled=fg-disabled.
  // Brio ground truth: icon-default=cobalt i:5 t:66, icon-muted=cobalt+7 i:7 t:37,
  //   icon-disabled=cobalt+8 i:7 t:23, icon-onAccent=cobalt-8 i:3 t:100.
  setChromatic("--tug-base-icon-default", fgMutedRef, fgMutedAngle, fgMutedI, fgMutedTone, 100, fgMutedPrimaryName);
  // icon-muted: Brio uses cobalt+7, i:7, t:37 (same as fg-subtle)
  if (isLight) {
    setChromatic("--tug-base-icon-muted", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
  } else {
    setChromatic("--tug-base-icon-muted", fgSubtleRef, fgSubtleAngle, txtISubtle, fgSubtleTone, 100, fgSubtlePrimaryName);
  }
  // icon-disabled: Brio uses cobalt+8, i:7, t:23 (same as fg-disabled)
  setChromatic("--tug-base-icon-disabled", fgDisabledRef, fgDisabledAngle, txtISubtle, fgDisabledTone, 100, fgDisabledPrimaryName);

  // icon-active: vivid primary text color (active/selected state)
  setChromatic("--tug-base-icon-active", txtRefW, txtAngleW, 100, isLight ? 22 : 80, 100, txtNameW);

  // icon-onAccent: Brio uses cobalt-8, i:3, t:100 (same as fg-inverse/fg-onAccent in dark)
  if (isLight) {
    setWhite("--tug-base-icon-onAccent");
  } else {
    setChromatic("--tug-base-icon-onAccent", fgInverseRef, fgInverseAngle, txtI, fgInverseTone, 100, fgInversePrimaryName);
  }

  // --- Borders / Dividers / Focus ---
  // In dark mode: borders use text hue (Brio/Bluenote pattern — cobalt/blue text).
  // In light mode: borders use atmosphere hue (Harmony pattern — yellow atmosphere).
  // This reflects the principle that on warm light backgrounds, structural elements
  // should harmonize with the warm atmosphere rather than the cool text hue.

  // Borders: dark mode — Brio ground truth:
  //   border-default: cobalt (offset=0), i:6, t:30
  //   border-muted:   cobalt+7 (= fgSubtleRef), i:7, t:37
  //   border-strong:  cobalt+8 (= fgDisabledRef), i:7, t:40
  //   border-inverse: cobalt (default), i:3, t:94 (= fgDefaultRef)
  // Light mode: atmosphere hue for borders (Harmony: yellow).

  // border-default: uses borderTint hue in both modes (configurable via recipe).
  const borderHueRef = borderTintRefW;
  const borderHueAngle = borderTintAngleW;
  const borderHueName = borderTintNameW;
  // border intensities from preset. [D03]
  const borderIBase = preset.borderIBase;
  const borderIStrong = preset.borderIStrong;

  // border-muted: borderTint hue at slightly different tone
  const borderMutedHueRef = borderTintRefW;
  const borderMutedHueAngle = borderTintAngleW;
  const borderMutedHueName = borderTintNameW;
  const borderMutedTone = isLight ? 36 : fgSubtleTone;
  const borderMutedI = isLight ? 10 : borderIStrong;

  // border-strong: borderTint hue shifted -5° for contrast distinction
  const borderStrongAngle = applyWarmthBias(borderTintHue, (borderTintAngle - 5 + 360) % 360);
  const borderStrongName = closestHueName(borderStrongAngle);
  const borderStrongRef = formatHueRef(borderStrongName, borderStrongAngle);
  const borderStrongHueRef = borderStrongRef;
  const borderStrongHueAngle = borderStrongAngle;
  const borderStrongHueName = primaryColorName(borderStrongName);
  const borderStrongTone = isLight ? Math.round(fgSubtleTone - 6) : 40;
  const borderStrongI = borderIStrong;

  setChromatic("--tug-base-border-default", borderHueRef, borderHueAngle, borderIBase, fgPlaceholderTone, 100, borderHueName);
  setChromatic("--tug-base-border-muted", borderMutedHueRef, borderMutedHueAngle, borderMutedI, borderMutedTone, 100, borderMutedHueName);
  setChromatic("--tug-base-border-strong", borderStrongHueRef, borderStrongHueAngle, borderStrongI, borderStrongTone, 100, borderStrongHueName);
  setChromatic("--tug-base-border-inverse", fgDefaultRefT, fgDefaultAngleT, txtI, fgDefaultTone, 100, fgDefaultNameT);
  setChromatic("--tug-base-border-accent", accentHue, accentAngle, signalI, 50, 100, accentName);
  setChromatic("--tug-base-border-danger", destructiveHue, resolveHueAngle(destructiveHue), signalI, 50);

  // dividers: borderTint hue (defaults to cardBg/atmosphere), very low intensity.
  // Brio ground truth: divider-default = violet-6, i:6, t:17
  //                    divider-muted   = violet, i:4, t:15
  // Dark mode: use specific Brio tones. dividerTone is also used for disabled/toggle/separator.
  const dividerDefaultTone = isLight ? Math.round(darkSurfaceOverlay - 2) : 17;
  const dividerMutedTone = isLight ? Math.round(darkSurfaceOverlay) : 15;
  // dividerTone: shared reference used by disabled/toggle/separator (= divider-default tone in dark)
  const dividerTone = dividerDefaultTone;
  // Derive the "bare base" for the borderTint hue (same logic as surfBareBaseRef but for borderTint).
  const borderTintBareBaseName = (() => {
    const hyphenIdx = borderTintHue.lastIndexOf("-");
    if (hyphenIdx > 0) {
      const lastSeg = borderTintHue.slice(hyphenIdx + 1);
      if (lastSeg in HUE_FAMILIES) return lastSeg;
    }
    return closestHueName(borderTintAngle);
  })();
  const borderTintBareAngle = applyWarmthBias(borderTintBareBaseName, HUE_FAMILIES[borderTintBareBaseName] ?? borderTintAngle);
  const borderTintBareName = closestHueName(borderTintBareAngle);
  // divider-default: dark=borderTintRefW (= atmRefW for Brio), i:6
  setChromatic("--tug-base-divider-default", borderTintRefW, borderTintAngleW, isLight ? atmI : 6, Math.round(dividerDefaultTone), 100, borderTintNameW);
  // divider-muted: dark=bare borderTint (= surfBareBaseRef for Brio), i:4
  if (isLight) {
    setChromatic("--tug-base-divider-muted", borderTintRefW, borderTintAngleW, atmI, Math.round(dividerMutedTone), 100, borderTintNameW);
  } else {
    setChromatic("--tug-base-divider-muted", borderTintBareBaseName, borderTintBareAngle, 4, Math.round(dividerMutedTone), 100, borderTintBareName);
  }

  // --- Elevation / Overlay ---
  // Shadows are always black-based with alpha; overlays black or white.
  // Alpha values from preset: dark mode uses higher alpha. [D03]
  const shadowXsAlpha = preset.shadowXsAlpha;
  const shadowMdAlpha = preset.shadowMdAlpha;
  const shadowLgAlpha = preset.shadowLgAlpha;
  const shadowXlAlpha = preset.shadowXlAlpha;
  const shadowOverlayAlpha = preset.shadowOverlayAlpha;
  const overlayDimAlpha = preset.overlayDimAlpha;
  const overlayScrimAlpha = preset.overlayScrimAlpha;
  const overlayHighlightAlpha = preset.overlayHighlightAlpha;

  setShadow("--tug-base-shadow-xs", shadowXsAlpha);
  setShadow("--tug-base-shadow-md", shadowMdAlpha);
  setShadow("--tug-base-shadow-lg", shadowLgAlpha);
  setShadow("--tug-base-shadow-xl", shadowXlAlpha);

  // shadow-overlay: composite value — structural prefix + embedded --tug-color()
  setStructural(
    "--tug-base-shadow-overlay",
    `0 4px 16px ${makeShadowToken(shadowOverlayAlpha)}`,
  );
  resolved["--tug-base-shadow-overlay"] = {
    ...BLACK_RESOLVED,
    alpha: shadowOverlayAlpha / 100,
  };

  setShadow("--tug-base-overlay-dim", overlayDimAlpha);
  setShadow("--tug-base-overlay-scrim", overlayScrimAlpha);
  // overlay-highlight: verbose white form with explicit i: 0, t: 100 per [D06] ground truth.
  // Cannot use setHighlight() (which emits compact --tug-color(white, a: N)) for this token.
  tokens["--tug-base-overlay-highlight"] = `--tug-color(white, i: 0, t: 100, a: ${overlayHighlightAlpha})`;
  resolved["--tug-base-overlay-highlight"] = { ...WHITE_RESOLVED, alpha: overlayHighlightAlpha / 100 };

  // --- Typography (invariant) ---
  setInvariant("--tug-base-font-family-sans", '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif');
  setInvariant("--tug-base-font-family-mono", '"Hack", "JetBrains Mono", "SFMono-Regular", "Menlo", monospace');
  setInvariant("--tug-base-font-size-2xs", "11px");
  setInvariant("--tug-base-font-size-xs", "12px");
  setInvariant("--tug-base-font-size-sm", "13px");
  setInvariant("--tug-base-font-size-md", "14px");
  setInvariant("--tug-base-font-size-lg", "16px");
  setInvariant("--tug-base-font-size-xl", "20px");
  setInvariant("--tug-base-font-size-2xl", "24px");
  setInvariant("--tug-base-line-height-2xs", "15px");
  setInvariant("--tug-base-line-height-xs", "17px");
  setInvariant("--tug-base-line-height-sm", "19px");
  setInvariant("--tug-base-line-height-md", "20px");
  setInvariant("--tug-base-line-height-lg", "24px");
  setInvariant("--tug-base-line-height-xl", "28px");
  setInvariant("--tug-base-line-height-2xl", "32px");
  setInvariant("--tug-base-line-height-tight", "1.2");
  setInvariant("--tug-base-line-height-normal", "1.45");

  // --- Spacing (invariant) ---
  setInvariant("--tug-base-space-2xs", "2px");
  setInvariant("--tug-base-space-xs", "4px");
  setInvariant("--tug-base-space-sm", "6px");
  setInvariant("--tug-base-space-md", "8px");
  setInvariant("--tug-base-space-lg", "12px");
  setInvariant("--tug-base-space-xl", "16px");
  setInvariant("--tug-base-space-2xl", "24px");

  // --- Radius (invariant) ---
  setInvariant("--tug-base-radius-2xs", "1px");
  setInvariant("--tug-base-radius-xs", "2px");
  setInvariant("--tug-base-radius-sm", "4px");
  setInvariant("--tug-base-radius-md", "6px");
  setInvariant("--tug-base-radius-lg", "8px");
  setInvariant("--tug-base-radius-xl", "12px");
  setInvariant("--tug-base-radius-2xl", "16px");

  // --- Chrome (invariant) ---
  setInvariant("--tug-base-chrome-height", "36px");

  // --- Icon Size (invariant) ---
  setInvariant("--tug-base-icon-size-2xs", "10px");
  setInvariant("--tug-base-icon-size-xs", "12px");
  setInvariant("--tug-base-icon-size-sm", "13px");
  setInvariant("--tug-base-icon-size-md", "15px");
  setInvariant("--tug-base-icon-size-lg", "20px");
  setInvariant("--tug-base-icon-size-xl", "24px");

  // --- Motion (invariant; duration tokens are calc-based in tug-base.css body{}) ---
  // Note: fast/moderate/slow/glacial are defined in the tug-base.css body{} block
  // (not :root) so they're part of the 264 token set.
  setInvariant("--tug-base-motion-duration-fast", "calc(100ms * var(--tug-timing))");
  setInvariant("--tug-base-motion-duration-moderate", "calc(200ms * var(--tug-timing))");
  setInvariant("--tug-base-motion-duration-slow", "calc(350ms * var(--tug-timing))");
  setInvariant("--tug-base-motion-duration-glacial", "calc(500ms * var(--tug-timing))");
  setInvariant("--tug-base-motion-duration-instant", "calc(0ms * var(--tug-timing))");
  setInvariant("--tug-base-motion-easing-standard", "cubic-bezier(0.2, 0, 0, 1)");
  setInvariant("--tug-base-motion-easing-enter", "cubic-bezier(0, 0, 0, 1)");
  setInvariant("--tug-base-motion-easing-exit", "cubic-bezier(0.2, 0, 1, 1)");
  // =========================================================================
  // B. Accent System
  // =========================================================================

  setChromatic("--tug-base-accent-default", accentHue, accentAngle, signalI, 50, 100, accentName);
  setChromatic("--tug-base-accent-subtle", accentHue, accentAngle, signalI, 50, 15, accentName);

  // accent-cool-default: Brio uses cobalt-intense (= text hue at i:90, t:50)
  setChromatic("--tug-base-accent-cool-default", txtRefW, txtAngleW, 90, 50, 100, txtNameW);

  // =========================================================================
  // C. Semantic Tones
  // =========================================================================

  const successAngle = resolveHueAngle(successHue);
  const successName = closestHueName(successAngle);
  const cautionAngle = resolveHueAngle(cautionHue);
  const cautionName = closestHueName(cautionAngle);
  const dangerAngle = resolveHueAngle(destructiveHue);
  const dangerName = closestHueName(dangerAngle);
  const agentAngle = resolveHueAngle(agentHue);
  const agentName = closestHueName(agentAngle);
  const dataAngle = resolveHueAngle(dataHue);
  const dataName = closestHueName(dataAngle);

  setChromatic("--tug-base-tone-accent", accentHue, accentAngle, signalI, 50, 100, accentName);
  setChromatic("--tug-base-tone-accent-bg", accentHue, accentAngle, signalI, 50, 15, accentName);
  setChromatic("--tug-base-tone-accent-fg", accentHue, accentAngle, signalI, 50, 100, accentName);
  setChromatic("--tug-base-tone-accent-border", accentHue, accentAngle, signalI, 50, 100, accentName);
  setChromatic("--tug-base-tone-accent-icon", accentHue, accentAngle, signalI, 50, 100, accentName);

  setChromatic("--tug-base-tone-active", activeHue, activeAngle, signalI, 50, 100, activeName);
  setChromatic("--tug-base-tone-active-bg", activeHue, activeAngle, signalI, 50, 15, activeName);
  setChromatic("--tug-base-tone-active-fg", activeHue, activeAngle, signalI, 50, 100, activeName);
  setChromatic("--tug-base-tone-active-border", activeHue, activeAngle, signalI, 50, 100, activeName);
  setChromatic("--tug-base-tone-active-icon", activeHue, activeAngle, signalI, 50, 100, activeName);

  setChromatic("--tug-base-tone-agent", agentHue, agentAngle, signalI, 50, 100, agentName);
  setChromatic("--tug-base-tone-agent-bg", agentHue, agentAngle, signalI, 50, 15, agentName);
  setChromatic("--tug-base-tone-agent-fg", agentHue, agentAngle, signalI, 50, 100, agentName);
  setChromatic("--tug-base-tone-agent-border", agentHue, agentAngle, signalI, 50, 100, agentName);
  setChromatic("--tug-base-tone-agent-icon", agentHue, agentAngle, signalI, 50, 100, agentName);

  setChromatic("--tug-base-tone-data", dataHue, dataAngle, signalI, 50, 100, dataName);
  setChromatic("--tug-base-tone-data-bg", dataHue, dataAngle, signalI, 50, 15, dataName);
  setChromatic("--tug-base-tone-data-fg", dataHue, dataAngle, signalI, 50, 100, dataName);
  setChromatic("--tug-base-tone-data-border", dataHue, dataAngle, signalI, 50, 100, dataName);
  setChromatic("--tug-base-tone-data-icon", dataHue, dataAngle, signalI, 50, 100, dataName);

  setChromatic("--tug-base-tone-success", successHue, successAngle, signalI, 50, 100, successName);
  setChromatic("--tug-base-tone-success-bg", successHue, successAngle, signalI, 50, 15, successName);
  setChromatic("--tug-base-tone-success-fg", successHue, successAngle, signalI, 50, 100, successName);
  setChromatic("--tug-base-tone-success-border", successHue, successAngle, signalI, 50, 100, successName);
  setChromatic("--tug-base-tone-success-icon", successHue, successAngle, signalI, 50, 100, successName);

  setChromatic("--tug-base-tone-caution", cautionHue, cautionAngle, signalI, 50, 100, cautionName);
  setChromatic("--tug-base-tone-caution-bg", cautionHue, cautionAngle, signalI, 50, 12, cautionName);
  setChromatic("--tug-base-tone-caution-fg", cautionHue, cautionAngle, signalI, 50, 100, cautionName);
  setChromatic("--tug-base-tone-caution-border", cautionHue, cautionAngle, signalI, 50, 100, cautionName);
  setChromatic("--tug-base-tone-caution-icon", cautionHue, cautionAngle, signalI, 50, 100, cautionName);

  setChromatic("--tug-base-tone-danger", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-tone-danger-bg", destructiveHue, dangerAngle, signalI, 50, 15, dangerName);
  setChromatic("--tug-base-tone-danger-fg", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-tone-danger-border", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-tone-danger-icon", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);

  // =========================================================================
  // D. Selection / Highlight / Preview
  // =========================================================================

  // selection-bg: [D05] use interactiveHue (cyan for Brio) at i:50, t:50, a:40
  setChromatic("--tug-base-selection-bg", interactiveRef, interactiveAngle, 50, 50, 40, interactiveName);
  // selection-bg-inactive: Brio uses yellow, i:0, t:30, a:25
  if (isLight) {
    // Light mode: atmosphere hue shifted toward amber (-20° from atm base) for warmth
    const selInactAngle = applyWarmthBias(atmHue, (atmBaseAngle - 20 + 360) % 360);
    const selInactName = closestHueName(selInactAngle);
    const selInactRef = formatHueRef(selInactName, selInactAngle);
    setChromatic("--tug-base-selection-bg-inactive", selInactRef, selInactAngle, 8, 24, 20, selInactName);
  } else {
    // Dark mode: Brio uses yellow, i:0, t:30, a:25
    setChromatic("--tug-base-selection-bg-inactive", "yellow", resolveHueAngle("yellow"), 0, 30, 25, "yellow");
  }
  setChromatic("--tug-base-selection-fg", fgDefaultRefT, fgDefaultAngleT, txtI, fgDefaultTone, 100, fgDefaultNameT);

  // highlights: [D05] use interactiveHue (cyan for Brio) for dropTarget/preview/inspectorTarget/snapGuide
  if (isLight) {
    setShadow("--tug-base-highlight-hover", 4);
    setChromatic("--tug-base-highlight-dropTarget", interactiveRef, interactiveAngle, 50, 50, 18, interactiveName);
    setChromatic("--tug-base-highlight-preview", interactiveRef, interactiveAngle, 50, 50, 12, interactiveName);
    setChromatic("--tug-base-highlight-inspectorTarget", interactiveRef, interactiveAngle, 50, 50, 22, interactiveName);
    setChromatic("--tug-base-highlight-snapGuide", interactiveRef, interactiveAngle, 50, 50, 50, interactiveName);
  } else {
    // highlight-hover: verbose white form with explicit i: 0, t: 100 per ground truth.
    // Cannot use setHighlight() (compact --tug-color(white, a: N)) for this token.
    tokens["--tug-base-highlight-hover"] = "--tug-color(white, i: 0, t: 100, a: 5)";
    resolved["--tug-base-highlight-hover"] = { ...WHITE_RESOLVED, alpha: 5 / 100 };
    setChromatic("--tug-base-highlight-dropTarget", interactiveRef, interactiveAngle, 50, 50, 18, interactiveName);
    setChromatic("--tug-base-highlight-preview", interactiveRef, interactiveAngle, 50, 50, 12, interactiveName);
    setChromatic("--tug-base-highlight-inspectorTarget", interactiveRef, interactiveAngle, 50, 50, 22, interactiveName);
    setChromatic("--tug-base-highlight-snapGuide", interactiveRef, interactiveAngle, 50, 50, 50, interactiveName);
  }
  setChromatic("--tug-base-highlight-flash", accentHue, accentAngle, signalI, 50, 35, accentName);

  // =========================================================================
  // D2. Tab Chrome
  // =========================================================================
  // Derived tab tokens that flow through the theme system so every theme can
  // tune them. The tab bar sits on surface-sunken; active tab should clearly
  // stand out as "raised" above inactive tabs.

  // tab-bg-active: base token for active tab background. Component CSS
  // (tug-tab.css) overrides this with --tug-card-title-bar-bg-active to
  // visually merge the active tab with the card title bar above it.
  // Uses cardFrame hue with preset intensity/tone values.
  // Dark: Brio original was --tug-color(indigo, i: 12, t: 18).
  // Light: atmosphere hue at lower intensity.
  const cfActiveI = preset.cardFrameActiveI;
  const cfActiveTone = preset.cardFrameActiveTone;
  const cfInactiveI = preset.cardFrameInactiveI;
  const cfInactiveTone = preset.cardFrameInactiveTone;

  if (isLight) {
    setChromatic("--tug-base-tab-bg-active", atmRefW, atmAngleW, cfActiveI, cfActiveTone, 100, atmNameW);
  } else {
    setChromatic("--tug-base-tab-bg-active", cardFrameRefW, cardFrameAngleW, cfActiveI, cfActiveTone, 100, cardFrameNameW);
  }

  // tab-bg-inactive: dimmer version of active, used for title bar and tab bar background.
  if (isLight) {
    setChromatic("--tug-base-tab-bg-inactive", atmRefW, atmAngleW, cfInactiveI, cfInactiveTone, 100, atmNameW);
  } else {
    setChromatic("--tug-base-tab-bg-inactive", cardFrameRefW, cardFrameAngleW, cfInactiveI, cfInactiveTone, 100, cardFrameNameW);
  }

  // tab-bg-collapsed: uses cardBg hue at inactive intensity for collapsed cards.
  if (isLight) {
    setChromatic("--tug-base-tab-bg-collapsed", atmRefW, atmAngleW, cfInactiveI, cfInactiveTone, 100, atmNameW);
  } else {
    setChromatic("--tug-base-tab-bg-collapsed", atmRefW, atmAngleW, cfInactiveI, cfInactiveTone, 100, atmNameW);
  }

  // tab-bg-hover: visible highlight when scanning inactive tabs
  if (isLight) {
    setShadow("--tug-base-tab-bg-hover", 6);
  } else {
    setHighlight("--tug-base-tab-bg-hover", 8);
  }

  // tab-fg-rest: Brio uses cobalt, i:7 (canonical tone=50) → "--tug-color(cobalt, i: 7)"
  setChromatic("--tug-base-tab-fg-rest", txtRefW, txtAngleW, txtISubtle, 50, 100, txtNameW);

  // tab-fg-hover: Brio uses cobalt, i:3, t:90
  const tabFgActiveTone = isLight ? fgDefaultTone : 90;
  setChromatic("--tug-base-tab-fg-hover", fgDefaultRefT, fgDefaultAngleT, txtI, tabFgActiveTone, 100, fgDefaultNameT);

  // tab-fg-active: Brio uses cobalt, i:3, t:90
  setChromatic("--tug-base-tab-fg-active", fgDefaultRefT, fgDefaultAngleT, txtI, tabFgActiveTone, 100, fgDefaultNameT);

  // tab-close-bg-hover: close button hover — subtle but visible overlay
  if (isLight) {
    setShadow("--tug-base-tab-close-bg-hover", 10);
  } else {
    setHighlight("--tug-base-tab-close-bg-hover", 12);
  }

  // tab-close-fg-hover: Brio uses cobalt, i:3, t:90
  setChromatic("--tug-base-tab-close-fg-hover", fgDefaultRefT, fgDefaultAngleT, txtI, tabFgActiveTone, 100, fgDefaultNameT);

  // =========================================================================
  // E. Control Surfaces
  // =========================================================================

  // --- Cross-Control Disabled Contract ---
  // Brio: disabled-bg=violet i:5 t:11, disabled-fg=cobalt+8 i:7 t:23,
  //       disabled-border=violet-6 i:6 t:17, disabled-icon=cobalt+8 i:7 t:23
  const disabledBgTone = isLight ? Math.round(70 + (surfaceContrast / 100) * 10) : 22;
  if (isLight) {
    setChromatic("--tug-base-control-disabled-bg", atmRefW, atmAngleW, 6, disabledBgTone);
  } else {
    setChromatic("--tug-base-control-disabled-bg", surfBareBaseRef, surfBareBaseAngle, atmI, disabledBgTone, 100, surfBareBaseName);
  }
  const disabledFgTone = isLight ? fgDisabledTone : 38;
  setChromatic("--tug-base-control-disabled-fg", fgDisabledRef, fgDisabledAngle, txtISubtle, disabledFgTone, 100, fgDisabledPrimaryName);
  const disabledBorderTone = isLight ? Math.round(dividerTone) : 28;
  setChromatic("--tug-base-control-disabled-border", atmRefW, atmAngleW, isLight ? atmIBorder : 6, disabledBorderTone);
  setChromatic("--tug-base-control-disabled-icon", fgDisabledRef, fgDisabledAngle, txtISubtle, disabledFgTone, 100, fgDisabledPrimaryName);
  setInvariant("--tug-base-control-disabled-opacity", "0.5");
  setStructural("--tug-base-control-disabled-shadow", "none");

  // --- Emphasis x Role Control Tokens (Table T01) [D02] ---
  // 8 combinations × 4 properties × 3 states = 96 tokens
  // Pattern: --tug-base-control-{emphasis}-{role}-{property}-{state}
  //
  // Filled emphasis: solid colored bg derived from role's canonical hue.
  //   bg: role hue at dark tone (rest) → hover → intense (active)
  //   fg: near-white (light text on dark colored bg)
  //   border: role hue at signalI
  //   icon: same as fg
  //
  // Outlined emphasis [D05]: medium emphasis; border carries role color; bg subtle.
  //   bg: role tone-{role}-bg equivalent (atmosphere-tinted, very subtle)
  //   fg: default text
  //   border: role tone-{role}-border equivalent
  //   icon: role tone-{role}-icon equivalent
  //
  // Ghost emphasis: transparent bg; fg carries role color.
  //   bg: transparent (rest) / subtle alpha (hover/active)
  //   fg: tone-{role}-fg equivalent
  //   border: transparent (rest) / subtle at hover/active
  //   icon: same as fg

  // Shared tone constants for filled emphasis (same across roles). From preset. [D03]
  const filledBgDarkTone = preset.filledBgDarkTone;
  const filledBgHoverTone = preset.filledBgHoverTone;
  const filledBgActiveTone = preset.filledBgActiveTone;
  const filledFgTone = 100; // near-white on colored bg

  // Accent hue ref (used in setChromatic)
  const accentRef = formatHueRef(accentName, accentAngle);

  // Agent hue ref (data not in Table T01 combinations)
  const agentRef = formatHueRef(agentName, agentAngle);

  // Outlined bg tones: same as secondary bg (atmosphere-tinted surface)
  const outlinedBgRestTone = isLight ? 51 : Math.round(darkSurfaceInset + 2);
  const outlinedBgHoverTone = isLight ? 99 : Math.round(darkSurfaceRaised + 1);
  const outlinedBgActiveTone = isLight ? 48 : Math.round(darkSurfaceOverlay);

  // --- Filled Accent (CTA — brand orange/accent hue) ---
  setChromatic("--tug-base-control-filled-accent-bg-rest", accentHue, accentAngle, 50, filledBgDarkTone, 100, accentName);
  setChromatic("--tug-base-control-filled-accent-bg-hover", accentHue, accentAngle, 55, filledBgHoverTone, 100, accentName);
  setChromatic("--tug-base-control-filled-accent-bg-active", accentHue, accentAngle, 90, filledBgActiveTone, 100, accentName);
  setChromatic("--tug-base-control-filled-accent-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-accent-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-accent-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-accent-border-rest", accentHue, accentAngle, Math.min(90, signalI + 5), 50, 100, accentName);
  setChromatic("--tug-base-control-filled-accent-border-hover", accentHue, accentAngle, Math.min(90, signalI + 15), 50, 100, accentName);
  setChromatic("--tug-base-control-filled-accent-border-active", accentHue, accentAngle, 90, filledBgActiveTone, 100, accentName);
  setChromatic("--tug-base-control-filled-accent-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-accent-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-accent-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);

  // --- Filled Active (standard interactive — active/blue hue) ---
  // Same solid-bg formula as old control-primary: preserves old blue filled button appearance
  setChromatic("--tug-base-control-filled-action-bg-rest", activeRef, activeAngle, 50, filledBgDarkTone, 100, activeName);
  setChromatic("--tug-base-control-filled-action-bg-hover", activeRef, activeAngle, 55, filledBgHoverTone, 100, activeName);
  setChromatic("--tug-base-control-filled-action-bg-active", activeRef, activeAngle, 90, filledBgActiveTone, 100, activeName);
  setChromatic("--tug-base-control-filled-action-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-action-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-action-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-action-border-rest", activeRef, activeAngle, Math.min(90, signalI + 5), 50, 100, activeName);
  setChromatic("--tug-base-control-filled-action-border-hover", activeRef, activeAngle, Math.min(90, signalI + 15), 50, 100, activeName);
  setChromatic("--tug-base-control-filled-action-border-active", activeRef, activeAngle, 90, filledBgActiveTone, 100, activeName);
  setChromatic("--tug-base-control-filled-action-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-action-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-action-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);

  // --- Filled Danger (destructive action — red/danger hue) ---
  setChromatic("--tug-base-control-filled-danger-bg-rest", destructiveHue, dangerAngle, 50, filledBgDarkTone, 100, dangerName);
  setChromatic("--tug-base-control-filled-danger-bg-hover", destructiveHue, dangerAngle, 55, filledBgHoverTone, 100, dangerName);
  setChromatic("--tug-base-control-filled-danger-bg-active", destructiveHue, dangerAngle, 90, filledBgActiveTone, 100, dangerName);
  setChromatic("--tug-base-control-filled-danger-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-danger-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-danger-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-danger-border-rest", destructiveHue, dangerAngle, Math.min(90, signalI + 5), 50, 100, dangerName);
  setChromatic("--tug-base-control-filled-danger-border-hover", destructiveHue, dangerAngle, Math.min(90, signalI + 15), 50, 100, dangerName);
  setChromatic("--tug-base-control-filled-danger-border-active", destructiveHue, dangerAngle, 90, filledBgActiveTone, 100, dangerName);
  setChromatic("--tug-base-control-filled-danger-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-danger-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-danger-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);

  // --- Filled Agent (AI action — violet/agent hue) ---
  // Same solid-bg formula as filled-action but with agentRef/agentAngle (violet).
  // fg uses light text (txtRefW at near-max tone) since agent is a dark-bg role.
  setChromatic("--tug-base-control-filled-agent-bg-rest", agentRef, agentAngle, 50, filledBgDarkTone, 100, agentName);
  setChromatic("--tug-base-control-filled-agent-bg-hover", agentRef, agentAngle, 55, filledBgHoverTone, 100, agentName);
  setChromatic("--tug-base-control-filled-agent-bg-active", agentRef, agentAngle, 90, filledBgActiveTone, 100, agentName);
  setChromatic("--tug-base-control-filled-agent-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-agent-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-agent-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-agent-border-rest", agentRef, agentAngle, Math.min(90, signalI + 5), 50, 100, agentName);
  setChromatic("--tug-base-control-filled-agent-border-hover", agentRef, agentAngle, Math.min(90, signalI + 15), 50, 100, agentName);
  setChromatic("--tug-base-control-filled-agent-border-active", agentRef, agentAngle, 90, filledBgActiveTone, 100, agentName);
  setChromatic("--tug-base-control-filled-agent-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-agent-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-agent-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);

  // --- Filled Data (data/teal hue — dark saturated bg like other filled roles) ---
  setChromatic("--tug-base-control-filled-data-bg-rest", dataHue, dataAngle, 50, filledBgDarkTone, 100, dataName);
  setChromatic("--tug-base-control-filled-data-bg-hover", dataHue, dataAngle, 55, filledBgHoverTone, 100, dataName);
  setChromatic("--tug-base-control-filled-data-bg-active", dataHue, dataAngle, 90, filledBgActiveTone, 100, dataName);
  setChromatic("--tug-base-control-filled-data-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-data-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-data-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-data-border-rest", dataHue, dataAngle, Math.min(90, signalI + 5), 50, 100, dataName);
  setChromatic("--tug-base-control-filled-data-border-hover", dataHue, dataAngle, Math.min(90, signalI + 15), 50, 100, dataName);
  setChromatic("--tug-base-control-filled-data-border-active", dataHue, dataAngle, 90, filledBgActiveTone, 100, dataName);
  setChromatic("--tug-base-control-filled-data-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-data-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-data-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);

  // --- Filled Success (success/green hue — dark saturated bg like other filled roles) ---
  setChromatic("--tug-base-control-filled-success-bg-rest", successHue, successAngle, 50, filledBgDarkTone, 100, successName);
  setChromatic("--tug-base-control-filled-success-bg-hover", successHue, successAngle, 55, filledBgHoverTone, 100, successName);
  setChromatic("--tug-base-control-filled-success-bg-active", successHue, successAngle, 90, filledBgActiveTone, 100, successName);
  setChromatic("--tug-base-control-filled-success-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-success-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-success-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-success-border-rest", successHue, successAngle, Math.min(90, signalI + 5), 50, 100, successName);
  setChromatic("--tug-base-control-filled-success-border-hover", successHue, successAngle, Math.min(90, signalI + 15), 50, 100, successName);
  setChromatic("--tug-base-control-filled-success-border-active", successHue, successAngle, 90, filledBgActiveTone, 100, successName);
  setChromatic("--tug-base-control-filled-success-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-success-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-success-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);

  // --- Filled Caution (caution/yellow hue — dark saturated bg like other filled roles) ---
  setChromatic("--tug-base-control-filled-caution-bg-rest", cautionHue, cautionAngle, 50, filledBgDarkTone, 100, cautionName);
  setChromatic("--tug-base-control-filled-caution-bg-hover", cautionHue, cautionAngle, 55, filledBgHoverTone, 100, cautionName);
  setChromatic("--tug-base-control-filled-caution-bg-active", cautionHue, cautionAngle, 90, filledBgActiveTone, 100, cautionName);
  setChromatic("--tug-base-control-filled-caution-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-caution-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-caution-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-caution-border-rest", cautionHue, cautionAngle, Math.min(90, signalI + 5), 50, 100, cautionName);
  setChromatic("--tug-base-control-filled-caution-border-hover", cautionHue, cautionAngle, Math.min(90, signalI + 15), 50, 100, cautionName);
  setChromatic("--tug-base-control-filled-caution-border-active", cautionHue, cautionAngle, 90, filledBgActiveTone, 100, cautionName);
  setChromatic("--tug-base-control-filled-caution-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-caution-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  setChromatic("--tug-base-control-filled-caution-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);

  // --- Outlined Action (transparent bg, action/blue border) [D05] ---
  // This is the default button style (emphasis="outlined" role="action") [D04].
  // Outlined = no fill. Border carries all the visual weight. Same border hue as filled-action.
  // Dark mode: white fg/icon (contrast against dark parent surface).
  // Light mode: default dark fg/icon (contrast against light parent surface).
  setStructural("--tug-base-control-outlined-action-bg-rest", "transparent");
  if (isLight) {
    setChromatic("--tug-base-control-outlined-action-bg-hover", atmRefW, atmAngleW, 4, outlinedBgHoverTone, 100, atmNameW);
    setChromatic("--tug-base-control-outlined-action-bg-active", atmRefW, atmAngleW, 6, outlinedBgActiveTone, 100, atmNameW);
  } else {
    setHighlight("--tug-base-control-outlined-action-bg-hover", 10);
    setHighlight("--tug-base-control-outlined-action-bg-active", 20);
  }
  if (isLight) {
    setChromatic("--tug-base-control-outlined-action-fg-rest", txtRefW, txtAngleW, txtI, fgDefaultTone);
    setChromatic("--tug-base-control-outlined-action-fg-hover", txtRefW, txtAngleW, txtI, 10);
    setChromatic("--tug-base-control-outlined-action-fg-active", txtRefW, txtAngleW, txtI, 8);
    setChromatic("--tug-base-control-outlined-action-icon-rest", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
    setChromatic("--tug-base-control-outlined-action-icon-hover", txtRefW, txtAngleW, txtISubtle, 22);
    setChromatic("--tug-base-control-outlined-action-icon-active", txtRefW, txtAngleW, txtISubtle, 13);
  } else {
    // White text/icons in dark mode
    setChromatic("--tug-base-control-outlined-action-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-action-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-action-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-action-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-action-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-action-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  }
  // Border: same action/blue hue as filled-action
  setChromatic("--tug-base-control-outlined-action-border-rest", activeRef, activeAngle, Math.min(90, signalI + 5), 50, 100, activeName);
  setChromatic("--tug-base-control-outlined-action-border-hover", activeRef, activeAngle, Math.min(90, signalI + 15), 50, 100, activeName);
  setChromatic("--tug-base-control-outlined-action-border-active", activeRef, activeAngle, Math.min(90, signalI + 25), 50, 100, activeName);

  // --- Outlined Agent (transparent bg, agent/violet border) [D05] ---
  // Same transparent-bg approach. Border from agent/violet hue.
  setStructural("--tug-base-control-outlined-agent-bg-rest", "transparent");
  if (isLight) {
    setChromatic("--tug-base-control-outlined-agent-bg-hover", atmRefW, atmAngleW, 4, outlinedBgHoverTone, 100, atmNameW);
    setChromatic("--tug-base-control-outlined-agent-bg-active", atmRefW, atmAngleW, 6, outlinedBgActiveTone, 100, atmNameW);
  } else {
    setHighlight("--tug-base-control-outlined-agent-bg-hover", 10);
    setHighlight("--tug-base-control-outlined-agent-bg-active", 20);
  }
  if (isLight) {
    setChromatic("--tug-base-control-outlined-agent-fg-rest", txtRefW, txtAngleW, txtI, fgDefaultTone);
    setChromatic("--tug-base-control-outlined-agent-fg-hover", txtRefW, txtAngleW, txtI, 10);
    setChromatic("--tug-base-control-outlined-agent-fg-active", txtRefW, txtAngleW, txtI, 8);
    setChromatic("--tug-base-control-outlined-agent-icon-rest", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
    setChromatic("--tug-base-control-outlined-agent-icon-hover", txtRefW, txtAngleW, txtISubtle, 22);
    setChromatic("--tug-base-control-outlined-agent-icon-active", txtRefW, txtAngleW, txtISubtle, 13);
  } else {
    // White text/icons in dark mode
    setChromatic("--tug-base-control-outlined-agent-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-agent-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-agent-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-agent-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-agent-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-agent-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  }
  setChromatic("--tug-base-control-outlined-agent-border-rest", agentRef, agentAngle, Math.min(90, signalI + 5), 50, 100, agentName);
  setChromatic("--tug-base-control-outlined-agent-border-hover", agentRef, agentAngle, Math.min(90, signalI + 15), 50, 100, agentName);
  setChromatic("--tug-base-control-outlined-agent-border-active", agentRef, agentAngle, Math.min(90, signalI + 25), 50, 100, agentName);

  // --- Ghost Active (link-like action — no role color in bg/border) ---
  // Preserves old ghost button appearance using neutral text hue.
  setStructural("--tug-base-control-ghost-action-bg-rest", "transparent");
  if (isLight) {
    setShadow("--tug-base-control-ghost-action-bg-hover", 6);
    setShadow("--tug-base-control-ghost-action-bg-active", 12);
  } else {
    setHighlight("--tug-base-control-ghost-action-bg-hover", 10);
    setHighlight("--tug-base-control-ghost-action-bg-active", 20);
  }
  if (isLight) {
    setChromatic("--tug-base-control-ghost-action-fg-rest", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
    setChromatic("--tug-base-control-ghost-action-fg-hover", txtRefW, txtAngleW, 9, 15);
    setChromatic("--tug-base-control-ghost-action-fg-active", txtRefW, txtAngleW, 9, 10);
  } else {
    setChromatic("--tug-base-control-ghost-action-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-ghost-action-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-ghost-action-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  }
  setStructural("--tug-base-control-ghost-action-border-rest", "transparent");
  setChromatic("--tug-base-control-ghost-action-border-hover", txtRefW, txtAngleW, isLight ? 10 : 20, isLight ? 35 : 60);
  setChromatic("--tug-base-control-ghost-action-border-active", txtRefW, txtAngleW, isLight ? 10 : 20, isLight ? 35 : 60);
  if (isLight) {
    setChromatic("--tug-base-control-ghost-action-icon-rest", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
    setChromatic("--tug-base-control-ghost-action-icon-hover", txtRefW, txtAngleW, txtISubtle, 22);
    setChromatic("--tug-base-control-ghost-action-icon-active", txtRefW, txtAngleW, 27, 13);
  } else {
    setChromatic("--tug-base-control-ghost-action-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-ghost-action-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-ghost-action-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  }

  // --- Ghost Danger (subtle destructive — danger/red fg, transparent bg) ---
  // Same transparent-bg approach as ghost-action but fg/icon from tone-danger-fg.
  // Hover bg uses danger-tinted subtle alpha.
  // Brio: bg-hover/active use i=signalI+5; fg/icon use i=signalI+5/+15/+25 progression.
  setStructural("--tug-base-control-ghost-danger-bg-rest", "transparent");
  if (isLight) {
    setChromatic("--tug-base-control-ghost-danger-bg-hover", destructiveHue, dangerAngle, Math.min(90, signalI + 5), 50, 8, dangerName);
    setChromatic("--tug-base-control-ghost-danger-bg-active", destructiveHue, dangerAngle, Math.min(90, signalI + 5), 50, 15, dangerName);
  } else {
    setChromatic("--tug-base-control-ghost-danger-bg-hover", destructiveHue, dangerAngle, Math.min(90, signalI + 5), 50, 10, dangerName);
    setChromatic("--tug-base-control-ghost-danger-bg-active", destructiveHue, dangerAngle, Math.min(90, signalI + 5), 50, 20, dangerName);
  }
  setChromatic("--tug-base-control-ghost-danger-fg-rest", destructiveHue, dangerAngle, Math.min(90, signalI + 5), 50, 100, dangerName);
  setChromatic("--tug-base-control-ghost-danger-fg-hover", destructiveHue, dangerAngle, Math.min(90, signalI + 15), 50, 100, dangerName);
  setChromatic("--tug-base-control-ghost-danger-fg-active", destructiveHue, dangerAngle, Math.min(90, signalI + 25), 50, 100, dangerName);
  setStructural("--tug-base-control-ghost-danger-border-rest", "transparent");
  setChromatic("--tug-base-control-ghost-danger-border-hover", destructiveHue, dangerAngle, Math.min(90, signalI + 5), 50, 40, dangerName);
  setChromatic("--tug-base-control-ghost-danger-border-active", destructiveHue, dangerAngle, Math.min(90, signalI + 5), 50, 60, dangerName);
  setChromatic("--tug-base-control-ghost-danger-icon-rest", destructiveHue, dangerAngle, Math.min(90, signalI + 5), 50, 100, dangerName);
  setChromatic("--tug-base-control-ghost-danger-icon-hover", destructiveHue, dangerAngle, Math.min(90, signalI + 15), 50, 100, dangerName);
  setChromatic("--tug-base-control-ghost-danger-icon-active", destructiveHue, dangerAngle, Math.min(90, signalI + 25), 50, 100, dangerName);

  // --- Outlined Option (calm configuration control — neutral muted border, no action-blue chroma) ---
  // [D01] Option role uses neutral fg-muted formulas: border from txtRefW at txtISubtle/fgMutedTone,
  // fg same as outlined-action, bg same as outlined-action, icon same as outlined-action.
  setStructural("--tug-base-control-outlined-option-bg-rest", "transparent");
  if (isLight) {
    setChromatic("--tug-base-control-outlined-option-bg-hover", atmRefW, atmAngleW, 4, outlinedBgHoverTone, 100, atmNameW);
    setChromatic("--tug-base-control-outlined-option-bg-active", atmRefW, atmAngleW, 6, outlinedBgActiveTone, 100, atmNameW);
  } else {
    setHighlight("--tug-base-control-outlined-option-bg-hover", 10);
    setHighlight("--tug-base-control-outlined-option-bg-active", 20);
  }
  if (isLight) {
    setChromatic("--tug-base-control-outlined-option-fg-rest", txtRefW, txtAngleW, txtI, fgDefaultTone);
    setChromatic("--tug-base-control-outlined-option-fg-hover", txtRefW, txtAngleW, txtI, 10);
    setChromatic("--tug-base-control-outlined-option-fg-active", txtRefW, txtAngleW, txtI, 8);
    setChromatic("--tug-base-control-outlined-option-icon-rest", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
    setChromatic("--tug-base-control-outlined-option-icon-hover", txtRefW, txtAngleW, txtISubtle, 22);
    setChromatic("--tug-base-control-outlined-option-icon-active", txtRefW, txtAngleW, txtISubtle, 13);
  } else {
    // White text/icons in dark mode
    setChromatic("--tug-base-control-outlined-option-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-option-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-option-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-option-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-option-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-outlined-option-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  }
  // Border: neutral text hue — Brio dark: cobalt i:7 (canonical t=50), i:9 t:55, i:11 t:60
  setChromatic("--tug-base-control-outlined-option-border-rest", txtRefW, txtAngleW, txtISubtle, isLight ? fgMutedTone : 50);
  setChromatic("--tug-base-control-outlined-option-border-hover", txtRefW, txtAngleW, Math.min(90, txtISubtle + 2), isLight ? fgMutedTone - 3 : 55);
  setChromatic("--tug-base-control-outlined-option-border-active", txtRefW, txtAngleW, Math.min(90, txtISubtle + 4), isLight ? fgMutedTone - 6 : 60);

  // --- Ghost Option (ultra-calm configuration control — transparent border at rest, fg-muted text) ---
  // [D01] Ghost-option: same bg hover/active as ghost-action but fg-muted at rest (calmer than ghost-action).
  setStructural("--tug-base-control-ghost-option-bg-rest", "transparent");
  if (isLight) {
    setShadow("--tug-base-control-ghost-option-bg-hover", 6);
    setShadow("--tug-base-control-ghost-option-bg-active", 12);
  } else {
    setHighlight("--tug-base-control-ghost-option-bg-hover", 10);
    setHighlight("--tug-base-control-ghost-option-bg-active", 20);
  }
  if (isLight) {
    setChromatic("--tug-base-control-ghost-option-fg-rest", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
    setChromatic("--tug-base-control-ghost-option-fg-hover", txtRefW, txtAngleW, 9, 15);
    setChromatic("--tug-base-control-ghost-option-fg-active", txtRefW, txtAngleW, 9, 10);
  } else {
    setChromatic("--tug-base-control-ghost-option-fg-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-ghost-option-fg-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-ghost-option-fg-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  }
  setStructural("--tug-base-control-ghost-option-border-rest", "transparent");
  setChromatic("--tug-base-control-ghost-option-border-hover", txtRefW, txtAngleW, isLight ? 10 : 20, isLight ? 35 : 60);
  setChromatic("--tug-base-control-ghost-option-border-active", txtRefW, txtAngleW, isLight ? 10 : 20, isLight ? 35 : 60);
  if (isLight) {
    setChromatic("--tug-base-control-ghost-option-icon-rest", txtRefW, txtAngleW, txtISubtle, fgMutedTone);
    setChromatic("--tug-base-control-ghost-option-icon-hover", txtRefW, txtAngleW, txtISubtle, 22);
    setChromatic("--tug-base-control-ghost-option-icon-active", txtRefW, txtAngleW, 27, 13);
  } else {
    setChromatic("--tug-base-control-ghost-option-icon-rest", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-ghost-option-icon-hover", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
    setChromatic("--tug-base-control-ghost-option-icon-active", txtRefW, txtAngleW, Math.max(1, txtI - 1), filledFgTone);
  }

  // --- Surface Control Alias [D08] ---
  // Semantic alias: non-button consumers (tabs, code blocks, menus) use this
  // instead of the raw outlined-action bg token. Decouples surface intent from
  // button emphasis x role naming.
  setStructural("--tug-base-surface-control", "var(--tug-base-control-outlined-action-bg-rest)");

  // --- Selected / Highlighted ---
  // Brio: control-selected-bg = blue, i:50, t:50, a:18 (canonical i=50, t=50 — verbose form per [D06])
  setChromatic("--tug-base-control-selected-bg", activeRef, activeAngle, 50, 50, 18, activeName);
  setChromatic("--tug-base-control-selected-bg-hover", activeRef, activeAngle, 50, 50, 24, activeName);
  setChromatic("--tug-base-control-selected-fg", fgDefaultRefT, fgDefaultAngleT, txtI, fgDefaultTone, 100, fgDefaultNameT);
  setChromatic("--tug-base-control-selected-border", activeRef, activeAngle, 50, 50, 100, activeName);
  setChromatic("--tug-base-control-selected-disabled-bg", activeRef, activeAngle, 50, 50, 10, activeName);
  setChromatic("--tug-base-control-highlighted-bg", activeRef, activeAngle, 50, 50, 10, activeName);
  setChromatic("--tug-base-control-highlighted-fg", fgDefaultRefT, fgDefaultAngleT, txtI, fgDefaultTone, 100, fgDefaultNameT);
  setChromatic("--tug-base-control-highlighted-border", activeRef, activeAngle, 50, 50, 25, activeName);

  // --- Generic Field Tokens — tone anchors from preset. [D03] ---
  const fieldBgRestTone = preset.fieldBgRestTone;
  const fieldBgHoverTone = preset.fieldBgHoverTone;
  const fieldBgFocusTone = preset.fieldBgFocusTone;
  const fieldBgDisabledTone = preset.fieldBgDisabledTone;
  const fieldBgReadOnlyTone = preset.fieldBgReadOnlyTone;

  // field-bg-rest: Brio=violet-6 i:5 t:8, field-bg-focus: Brio=violet-6 i:4 t:7
  setChromatic("--tug-base-field-bg-rest", atmRefW, atmAngleW, isLight ? 7 : atmI, fieldBgRestTone);
  // field-bg-hover: Brio=violet (bare), i:5, t:11
  if (isLight) {
    setChromatic("--tug-base-field-bg-hover", atmRefW, atmAngleW, atmI, fieldBgHoverTone);
  } else {
    setChromatic("--tug-base-field-bg-hover", surfBareBaseRef, surfBareBaseAngle, atmI, fieldBgHoverTone, 100, surfBareBaseName);
  }
  setChromatic("--tug-base-field-bg-focus", atmRefW, atmAngleW, 4, fieldBgFocusTone);
  setChromatic("--tug-base-field-bg-disabled", atmRefW, atmAngleW, atmI, fieldBgDisabledTone);
  // field-bg-readOnly: Brio=violet (bare), i:5, t:11
  if (isLight) {
    setChromatic("--tug-base-field-bg-readOnly", atmRefW, atmAngleW, atmI, fieldBgReadOnlyTone);
  } else {
    setChromatic("--tug-base-field-bg-readOnly", surfBareBaseRef, surfBareBaseAngle, atmI, fieldBgReadOnlyTone, 100, surfBareBaseName);
  }

  setChromatic("--tug-base-field-fg", fgDefaultRefT, fgDefaultAngleT, txtI, fgDefaultTone, 100, fgDefaultNameT);
  // field-fg-disabled: Brio uses cobalt+8, i:7, t:23
  setChromatic("--tug-base-field-fg-disabled", fgDisabledRef, fgDisabledAngle, txtISubtle, fgDisabledTone, 100, fgDisabledPrimaryName);
  // field-fg-readOnly: Brio uses cobalt, i:5, t:66 (= fg-muted)
  setChromatic("--tug-base-field-fg-readOnly", fgMutedRef, fgMutedAngle, fgMutedI, fgMutedTone, 100, fgMutedPrimaryName);
  // field-placeholder / field-border: in light mode use atmosphere hue (Harmony pattern)
  // Brio dark: field-placeholder=cobalt i:6 t:30, field-border-rest=cobalt i:6 t:30,
  //            field-border-hover=cobalt+7 i:7 t:37
  if (isLight) {
    setChromatic("--tug-base-field-placeholder", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
    setChromatic("--tug-base-field-border-rest", atmRefW, atmAngleW, atmIBorder, fgPlaceholderTone, 100, atmNameW);
    // field-border-hover in light mode: Harmony uses yellow-5 (same as border-strong: atm-5°)
    setChromatic("--tug-base-field-border-hover", borderStrongHueRef, borderStrongHueAngle, borderIStrong, borderStrongTone, 100, borderStrongHueName);
  } else {
    setChromatic("--tug-base-field-placeholder", fgPlaceholderRef, fgPlaceholderAngle, fgPlaceholderI, fgPlaceholderTone);
    setChromatic("--tug-base-field-border-rest", fgPlaceholderRef, fgPlaceholderAngle, fgPlaceholderI, fgPlaceholderTone);
    setChromatic("--tug-base-field-border-hover", fgSubtleRef, fgSubtleAngle, txtISubtle, fgSubtleTone);
  }
  // field-border-active: [D05] use interactiveHue (cyan for Brio) at canonical i:50, t:50
  setChromatic("--tug-base-field-border-active", interactiveRef, interactiveAngle, 50, 50, 100, interactiveName);
  setChromatic("--tug-base-field-border-danger", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-field-border-success", successHue, successAngle, signalI, 50, 100, successName);
  setChromatic("--tug-base-field-border-disabled", atmRefW, atmAngleW, atmIBorder, Math.round(dividerTone));
  setChromatic("--tug-base-field-border-readOnly", atmRefW, atmAngleW, atmIBorder, Math.round(dividerTone));

  // field-label: uses fg-default for full readability
  setChromatic("--tug-base-field-label", txtRefW, txtAngleW, txtI, fgDefaultTone, 100, txtNameW);
  setChromatic("--tug-base-field-required", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-field-tone-danger", destructiveHue, dangerAngle, signalI, 50, 100, dangerName);
  setChromatic("--tug-base-field-tone-caution", cautionHue, cautionAngle, signalI, 50, 100, cautionName);
  setChromatic("--tug-base-field-tone-success", successHue, successAngle, signalI, 50, 100, successName);

  // --- Toggle / Range Tokens ---
  // Toggle track: atmosphere (off) or accent (on)
  const toggleTrackOffTone = isLight ? Math.round(dividerTone) : 28;
  setChromatic("--tug-base-toggle-track-off", atmRefW, atmAngleW, atmIBorder, toggleTrackOffTone);
  setChromatic("--tug-base-toggle-track-off-hover", atmRefW, atmAngleW, Math.min(atmIBorder + 4, 100), Math.min(toggleTrackOffTone + 8, 100));
  // toggle-track-on: Brio uses orange-muted (= i:50, t:42) — matches muted preset
  setChromatic("--tug-base-toggle-track-on", accentHue, accentAngle, signalI, 42, 100, accentName);
  setChromatic("--tug-base-toggle-track-on-hover", accentHue, accentAngle, Math.min(signalI + 5, 100), preset.toggleTrackOnHoverTone, 100, accentName);
  // toggle-track-disabled: needs enough contrast against surface-default (t:12)
  const toggleDisabledTone = isLight ? Math.round(darkSurfaceOverlay) : 22;
  if (isLight) {
    setChromatic("--tug-base-toggle-track-disabled", atmRefW, atmAngleW, 6, toggleDisabledTone, 100, atmNameW);
  } else {
    setChromatic("--tug-base-toggle-track-disabled", surfBareBaseRef, surfBareBaseAngle, atmI, toggleDisabledTone, 100, surfBareBaseName);
  }
  // toggle-track-mixed: Brio uses cobalt+7, i:7, t:37 (= fgSubtleRef)
  setChromatic("--tug-base-toggle-track-mixed", fgSubtleRef, fgSubtleAngle, txtISubtle, fgSubtleTone, 100, fgSubtlePrimaryName);
  setChromatic("--tug-base-toggle-track-mixed-hover", fgSubtleRef, fgSubtleAngle, Math.min(txtISubtle + 5, 100), Math.min(fgSubtleTone + 6, 100), 100, fgSubtlePrimaryName);

  // Thumb: Brio dark uses cobalt-8, i:3, t:100 (= fg-inverse)
  if (isLight) {
    setWhite("--tug-base-toggle-thumb");
  } else {
    setChromatic("--tug-base-toggle-thumb", fgInverseRef, fgInverseAngle, txtI, fgInverseTone, 100, fgInversePrimaryName);
  }
  // toggle-thumb-disabled: needs contrast against disabled track
  const toggleThumbDisabledTone = isLight ? fgDisabledTone : 40;
  setChromatic("--tug-base-toggle-thumb-disabled", fgDisabledRef, fgDisabledAngle, txtISubtle, toggleThumbDisabledTone, 100, fgDisabledPrimaryName);
  setChromatic("--tug-base-toggle-icon-disabled", fgDisabledRef, fgDisabledAngle, txtISubtle, toggleThumbDisabledTone, 100, fgDisabledPrimaryName);
  setChromatic("--tug-base-toggle-icon-mixed", fgMutedRef, fgMutedAngle, fgMutedI, fgMutedTone, 100, fgMutedPrimaryName);

  // Checkmark / radio: Brio dark uses cobalt-8, i:3, t:100 (= fg-inverse)
  if (isLight) {
    setWhite("--tug-base-checkmark");
    setWhite("--tug-base-radio-dot");
  } else {
    setChromatic("--tug-base-checkmark", fgInverseRef, fgInverseAngle, txtI, fgInverseTone, 100, fgInversePrimaryName);
    setChromatic("--tug-base-radio-dot", fgInverseRef, fgInverseAngle, txtI, fgInverseTone, 100, fgInversePrimaryName);
  }
  setChromatic("--tug-base-checkmark-mixed", fgMutedRef, fgMutedAngle, fgMutedI, fgMutedTone, 100, fgMutedPrimaryName);

  // --- Separator ---
  setChromatic("--tug-base-separator", atmRefW, atmAngleW, atmIBorder, toggleTrackOffTone);

  // =========================================================================
  // F. Badge Tinted Tokens
  // Badge-specific tinted emphasis tokens for --tug-base-badge-tinted-{role}-*
  // 7 roles × 3 properties (fg, bg, border) = 21 tokens
  // FG: role hue at badgeTintedFgI, badgeTintedFgTone (alpha=100)
  // BG: role hue at badgeTintedBgI, badgeTintedBgTone, alpha=badgeTintedBgAlpha
  // Border: role hue at badgeTintedBorderI, badgeTintedBorderTone, alpha=badgeTintedBorderAlpha
  // =========================================================================

  const btFgI = preset.badgeTintedFgI;
  const btFgTone = preset.badgeTintedFgTone;
  const btBgI = preset.badgeTintedBgI;
  const btBgTone = preset.badgeTintedBgTone;
  const btBgAlpha = preset.badgeTintedBgAlpha;
  const btBorderI = preset.badgeTintedBorderI;
  const btBorderTone = preset.badgeTintedBorderTone;
  const btBorderAlpha = preset.badgeTintedBorderAlpha;

  // --- badge-tinted-accent (orange) ---
  setChromatic("--tug-base-badge-tinted-accent-fg", accentHue, accentAngle, btFgI, btFgTone, 100, accentName);
  setChromatic("--tug-base-badge-tinted-accent-bg", accentHue, accentAngle, btBgI, btBgTone, btBgAlpha, accentName);
  setChromatic("--tug-base-badge-tinted-accent-border", accentHue, accentAngle, btBorderI, btBorderTone, btBorderAlpha, accentName);

  // --- badge-tinted-action (blue) ---
  setChromatic("--tug-base-badge-tinted-action-fg", activeHue, activeAngle, btFgI, btFgTone, 100, activeName);
  setChromatic("--tug-base-badge-tinted-action-bg", activeHue, activeAngle, btBgI, btBgTone, btBgAlpha, activeName);
  setChromatic("--tug-base-badge-tinted-action-border", activeHue, activeAngle, btBorderI, btBorderTone, btBorderAlpha, activeName);

  // --- badge-tinted-agent (violet) ---
  setChromatic("--tug-base-badge-tinted-agent-fg", agentHue, agentAngle, btFgI, btFgTone, 100, agentName);
  setChromatic("--tug-base-badge-tinted-agent-bg", agentHue, agentAngle, btBgI, btBgTone, btBgAlpha, agentName);
  setChromatic("--tug-base-badge-tinted-agent-border", agentHue, agentAngle, btBorderI, btBorderTone, btBorderAlpha, agentName);

  // --- badge-tinted-data (teal) ---
  setChromatic("--tug-base-badge-tinted-data-fg", dataHue, dataAngle, btFgI, btFgTone, 100, dataName);
  setChromatic("--tug-base-badge-tinted-data-bg", dataHue, dataAngle, btBgI, btBgTone, btBgAlpha, dataName);
  setChromatic("--tug-base-badge-tinted-data-border", dataHue, dataAngle, btBorderI, btBorderTone, btBorderAlpha, dataName);

  // --- badge-tinted-danger (red) ---
  setChromatic("--tug-base-badge-tinted-danger-fg", destructiveHue, dangerAngle, btFgI, btFgTone, 100, dangerName);
  setChromatic("--tug-base-badge-tinted-danger-bg", destructiveHue, dangerAngle, btBgI, btBgTone, btBgAlpha, dangerName);
  setChromatic("--tug-base-badge-tinted-danger-border", destructiveHue, dangerAngle, btBorderI, btBorderTone, btBorderAlpha, dangerName);

  // --- badge-tinted-success (green) ---
  setChromatic("--tug-base-badge-tinted-success-fg", successHue, successAngle, btFgI, btFgTone, 100, successName);
  setChromatic("--tug-base-badge-tinted-success-bg", successHue, successAngle, btBgI, btBgTone, btBgAlpha, successName);
  setChromatic("--tug-base-badge-tinted-success-border", successHue, successAngle, btBorderI, btBorderTone, btBorderAlpha, successName);

  // --- badge-tinted-caution (yellow) ---
  setChromatic("--tug-base-badge-tinted-caution-fg", cautionHue, cautionAngle, btFgI, btFgTone, 100, cautionName);
  setChromatic("--tug-base-badge-tinted-caution-bg", cautionHue, cautionAngle, btBgI, btBgTone, btBgAlpha, cautionName);
  setChromatic("--tug-base-badge-tinted-caution-border", cautionHue, cautionAngle, btBorderI, btBorderTone, btBorderAlpha, cautionName);

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
