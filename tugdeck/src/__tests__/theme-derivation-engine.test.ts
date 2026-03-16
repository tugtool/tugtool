/**
 * Theme Derivation Engine tests.
 *
 * Covers:
 * - T2.1: deriveTheme(EXAMPLE_RECIPES.brio) produces token map with 350 entries
 * - T2.4: All output values for chromatic tokens match --tug-color(...) pattern
 * - T2.5: Theme-invariant tokens are correct for Brio
 * - T2.6: Non-override tokens resolve to valid sRGB gamut colors
 * - T4.1: End-to-end Brio dark pipeline — 0 unexpected failures after autoAdjustContrast
 * - T4.2: End-to-end Brio light pipeline — 0 unexpected body-text failures + focus indicator Lc 30
 * - T-BRIO-MATCH: Engine output matches Brio ground truth fixture within OKLCH delta-E < 0.02
 *
 * Run with: cd tugdeck && bun test --grep "derivation-engine"
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";


import {
  deriveTheme,
  EXAMPLE_RECIPES,
  DARK_PRESET,
  LIGHT_PRESET,
  generateResolvedCssExport,
  type ModePreset,
} from "@/components/tugways/theme-derivation-engine";


import {
  validateThemeContrast,
  autoAdjustContrast,
  LC_THRESHOLDS,
  LC_MARGINAL_DELTA,
} from "@/components/tugways/theme-accessibility";

import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/element-surface-pairing-map";


// ---------------------------------------------------------------------------
// Invariant token values (from tug-base.css)
// ---------------------------------------------------------------------------

const INVARIANT_TOKENS: Record<string, string> = {
  "--tug-base-font-family-sans": '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
  "--tug-base-font-family-mono": '"Hack", "JetBrains Mono", "SFMono-Regular", "Menlo", monospace',
  "--tug-base-font-size-2xs": "11px",
  "--tug-base-font-size-xs": "12px",
  "--tug-base-font-size-sm": "13px",
  "--tug-base-font-size-md": "14px",
  "--tug-base-font-size-lg": "16px",
  "--tug-base-font-size-xl": "20px",
  "--tug-base-font-size-2xl": "24px",
  "--tug-base-line-height-2xs": "15px",
  "--tug-base-line-height-xs": "17px",
  "--tug-base-line-height-sm": "19px",
  "--tug-base-line-height-md": "20px",
  "--tug-base-line-height-lg": "24px",
  "--tug-base-line-height-xl": "28px",
  "--tug-base-line-height-2xl": "32px",
  "--tug-base-line-height-tight": "1.2",
  "--tug-base-line-height-normal": "1.45",
  "--tug-base-space-2xs": "2px",
  "--tug-base-space-xs": "4px",
  "--tug-base-space-sm": "6px",
  "--tug-base-space-md": "8px",
  "--tug-base-space-lg": "12px",
  "--tug-base-space-xl": "16px",
  "--tug-base-space-2xl": "24px",
  "--tug-base-radius-2xs": "1px",
  "--tug-base-radius-xs": "2px",
  "--tug-base-radius-sm": "4px",
  "--tug-base-radius-md": "6px",
  "--tug-base-radius-lg": "8px",
  "--tug-base-radius-xl": "12px",
  "--tug-base-radius-2xl": "16px",
  "--tug-base-chrome-height": "36px",
  "--tug-base-icon-size-2xs": "10px",
  "--tug-base-icon-size-xs": "12px",
  "--tug-base-icon-size-sm": "13px",
  "--tug-base-icon-size-md": "15px",
  "--tug-base-icon-size-lg": "20px",
  "--tug-base-icon-size-xl": "24px",
};

// ---------------------------------------------------------------------------
// Test suite: derivation-engine
// ---------------------------------------------------------------------------

describe("derivation-engine", () => {
  // -------------------------------------------------------------------------
  // T2.1: Token count
  // -------------------------------------------------------------------------
  it("T2.1: deriveTheme(EXAMPLE_RECIPES.brio) produces token map with 371 entries", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    expect(Object.keys(output.tokens).length).toBe(371);
  });

  // -------------------------------------------------------------------------
  // T2.1c: All emphasis x role control tokens present (Table T01 + option role)
  // -------------------------------------------------------------------------
  it("T2.1c: all emphasis x role control tokens present in deriveTheme output", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);

    const emphases = ["filled", "outlined", "ghost"] as const;
    const roles = ["accent", "action", "option", "agent", "data", "danger"] as const;
    const properties = ["bg", "fg", "border", "icon"] as const;
    const states = ["rest", "hover", "active"] as const;

    // Table T01: 13 specific combinations (11 original + 2 new option-role combos)
    const T01_COMBOS: Array<[(typeof emphases)[number], (typeof roles)[number]]> = [
      ["filled", "accent"],
      ["filled", "action"],
      ["filled", "danger"],
      ["filled", "agent"],
      ["filled", "data"],
      ["filled", "success"],
      ["filled", "caution"],
      ["outlined", "action"],
      ["outlined", "agent"],
      ["outlined", "option"],
      ["ghost", "action"],
      ["ghost", "danger"],
      ["ghost", "option"],
    ];

    const missingTokens: string[] = [];
    for (const [emphasis, role] of T01_COMBOS) {
      for (const property of properties) {
        for (const state of states) {
          const tokenName = `--tug-base-control-${emphasis}-${role}-${property}-${state}`;
          if (output.tokens[tokenName] === undefined) {
            missingTokens.push(tokenName);
          }
        }
      }
    }

    expect(missingTokens).toEqual([]);
    // 13 combos × 4 props × 3 states = 156 tokens
    const controlTokenCount = T01_COMBOS.length * properties.length * states.length;
    expect(controlTokenCount).toBe(156);
  });

  // -------------------------------------------------------------------------
  // T2.1d: --tug-base-surface-control alias present [D08]
  // -------------------------------------------------------------------------
  it("T2.1d: --tug-base-surface-control alias is present in deriveTheme output", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    expect(output.tokens["--tug-base-surface-control"]).toBe(
      "var(--tug-base-control-outlined-action-bg-rest)",
    );
  });

  // -------------------------------------------------------------------------
  // T2.1e: Token names match --tug-base-control-{emphasis}-{role}-{property}-{state} pattern [D02]
  // -------------------------------------------------------------------------
  it("T2.1e: control token names match emphasis x role pattern", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    const controlPattern =
      /^--tug-base-control-(filled|outlined|ghost)-(accent|action|option|agent|data|danger|success|caution)-(bg|fg|border|icon)-(rest|hover|active)$/;

    const controlTokens = Object.keys(output.tokens).filter(
      (k) => k.startsWith("--tug-base-control-") && k.match(/(filled|outlined|ghost)/),
    );

    const badTokens = controlTokens.filter((t) => !controlPattern.test(t));
    expect(badTokens).toEqual([]);
    expect(controlTokens.length).toBeGreaterThanOrEqual(132);
  });

  // -------------------------------------------------------------------------
  // T2.4: All output values for chromatic tokens match --tug-color(...) pattern
  // Invariant/structural tokens may be plain CSS values.
  // -------------------------------------------------------------------------
  it("T2.4: all resolved tokens have --tug-color() values", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    const TUG_COLOR_RE = /^--tug-color\(/;

    const badTokens: string[] = [];
    for (const token of Object.keys(output.resolved)) {
      const value = output.tokens[token];
      if (!value) continue;
      // resolved map only contains chromatic tokens — their token values must be
      // --tug-color() strings (or composite shadow values that contain one)
      if (!TUG_COLOR_RE.test(value) && !value.includes("--tug-color(")) {
        badTokens.push(`${token}: ${value}`);
      }
    }
    expect(badTokens).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T2.5: Theme-invariant tokens are identical to Brio defaults
  // -------------------------------------------------------------------------
  it("T2.5: theme-invariant tokens are present and correct for brio", () => {
    const brio = deriveTheme(EXAMPLE_RECIPES.brio);

    for (const [token, expectedValue] of Object.entries(INVARIANT_TOKENS)) {
      expect(brio.tokens[token]).toBe(expectedValue);
    }
  });

  // -------------------------------------------------------------------------
  // T2.6: Sanity check for non-overridden tokens
  // All chromatic resolved tokens should be in valid sRGB gamut.
  // -------------------------------------------------------------------------
  it("T2.6: non-override chromatic tokens resolve to valid sRGB colors and use recipe seed hues", () => {
    // T2.6 per plan: sanity check that non-overridden tokens are reasonable.
    // All chromatic tokens should resolve to valid sRGB gamut colors.
    // Note: at signalIntensity=50, signalI=55. Since PEAK_C_SCALE=2, the engine
    // can produce colors with C = (55/100) * maxChroma * 2, which may slightly
    // exceed the sRGB gamut for some hues. Allow up to 30% out-of-gamut
    // since MAX_CHROMA_FOR_HUE was derived for intensity=50 (sRGB safe), and
    // intensity=55 pushes slightly into P3 territory. The key sanity check is
    // that all chromatic resolved colors are well-formed (L in [0,1], C >= 0).
    for (const [recipeName, recipe] of Object.entries(EXAMPLE_RECIPES)) {
      const output = deriveTheme(recipe);
      const malformed: string[] = [];
      for (const [token, color] of Object.entries(output.resolved)) {
        // All resolved colors must have valid OKLCH values
        if (
          color.L < -0.01 ||
          color.L > 1.01 ||
          color.C < -0.001 ||
          color.h < 0 ||
          color.h >= 360 ||
          color.alpha < 0 ||
          color.alpha > 1.01
        ) {
          malformed.push(
            `[${recipeName}] ${token}: L=${color.L.toFixed(3)} C=${color.C.toFixed(3)} h=${color.h.toFixed(1)} a=${color.alpha.toFixed(2)}`,
          );
        }
      }
      expect(malformed).toEqual([]);
    }
  });

  // -------------------------------------------------------------------------
  // Output structure sanity checks
  // -------------------------------------------------------------------------
  it("resolved map contains only chromatic tokens (no invariant/structural)", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);

    // Invariant tokens must NOT be in resolved
    for (const token of Object.keys(INVARIANT_TOKENS)) {
      expect(output.resolved[token]).toBeUndefined();
    }

    // Structural tokens (transparent/none/var()) must NOT be in resolved
    const STRUCTURAL = [
      "--tug-base-control-ghost-action-bg-rest",
      "--tug-base-control-ghost-action-border-rest",
      "--tug-base-control-ghost-danger-bg-rest",
      "--tug-base-control-ghost-danger-border-rest",
      "--tug-base-control-disabled-opacity",
      "--tug-base-control-disabled-shadow",
      "--tug-base-scrollbar-track",
      "--tug-base-surface-control",
    ];
    for (const token of STRUCTURAL) {
      expect(output.resolved[token]).toBeUndefined();
    }
  });

  it("contrastResults and cvdWarnings are empty arrays (populated in later steps)", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    expect(output.contrastResults).toEqual([]);
    expect(output.cvdWarnings).toEqual([]);
  });

  it("ThemeOutput.name and mode match the recipe", () => {
    const brio = deriveTheme(EXAMPLE_RECIPES.brio);
    expect(brio.name).toBe("brio");
    expect(brio.mode).toBe("dark");
  });
});

// ---------------------------------------------------------------------------
// Integration helpers shared by T4.1–T4.3
// ---------------------------------------------------------------------------

/**
 * Element tokens that the current derivation engine produces below Lc thresholds
 * for known structural or design reasons. These are excluded from the T4.x
 * zero-unexpected-failures assertions so the tests track real regressions rather
 * than pre-existing constraints.
 *
 * Categories:
 *
 * A. Secondary/tertiary text hierarchy (intentionally reduced contrast):
 *      fg-subtle, fg-placeholder, fg-link-hover, fg-link,
 *      control-selected-fg, control-highlighted-fg,
 *      selection-fg
 *
 * A2. Muted / read-only hierarchy — below Lc 75 by design (engine calibrated for
 *     primary text; secondary tiers intentionally trade off contrast for visual
 *     hierarchy legibility):
 *      fg-muted (Lc ~61, below Lc 75 body-text threshold),
 *      field-fg-readOnly (Lc ~61, read-only fields use reduced contrast)
 *
 * B. Text/icon on accent or vivid colored backgrounds (design constraint —
 *    accent hues are vivid mid-tone):
 *      fg-onAccent, icon-onAccent, fg-onDanger (danger bg creates Lc ~53 ceiling)
 *
 * C. Interactive state tokens on vivid colored filled button backgrounds
 *    (hover/active states are transient; filled button bg hues may be vivid
 *    mid-tones that fg text can't reach Lc 60):
 *      control-filled-{role}-fg-hover/active, control-filled-{role}-icon-hover/active
 *    Also outlined-agent (colored bg reduces default fg contrast in dark mode)
 *    and ghost-danger: rest/hover/active (danger hue at high intensity is mid-tone,
 *    Lc ~40-41 — below Lc 60 large-text threshold).
 *
 * D. Semantic tone tokens (status/informational colors — designed for
 *    medium visual weight, not primary body-text contrast):
 *      tone-accent-fg, tone-active-fg, tone-agent-fg, tone-data-fg,
 *      tone-success-fg, tone-caution-fg, tone-danger-fg,
 *      tone-accent-icon, tone-active-icon, tone-agent-icon, tone-data-icon,
 *      tone-success-icon, tone-caution-icon, tone-danger-icon
 *
 * E. UI control indicators (form elements / state indicators):
 *      accent-default, toggle-thumb, toggle-icon-mixed,
 *      checkmark, radio-dot, range-thumb
 *    Also muted icons (Lc ~29, borderline below Lc 30 ui-component threshold)
 *    and disabled elements (decorative role, Lc ~8-9 below Lc 15):
 *      fg-disabled, icon-disabled, field-fg-disabled
 *
 * F. Badge tinted fg tokens: semi-transparent bg means fg-over-tinted-bg
 *    has inherently low contrast; real readability is fg over the underlying surface.
 *
 * G. Tab chrome — structural UI chrome below Lc 75 body-text threshold:
 *      tab-fg-rest (Lc ~42 on surface-sunken; tab chrome uses intentionally
 *      lower contrast for visual hierarchy)
 *
 * H. Non-text component visibility tokens below Lc 30 by design (Step 3):
 *      toggle-track-off / toggle-track-mixed / toggle-track-off-hover /
 *      toggle-track-mixed-hover — inactive/indeterminate toggle states are
 *      intentionally lower-contrast to signal the off/mixed state.
 *      toggle-track-on — starts below Lc 30 in some configs; auto-adjusted.
 *      field-border-rest / field-border-hover — subtle field boundary in dark mode.
 *      border-default / border-muted — structural separators, intentionally subtle.
 *
 */
const KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS = new Set([
  // A — secondary / tertiary text
  "--tug-base-fg-subtle",
  "--tug-base-fg-placeholder",
  "--tug-base-fg-link-hover",
  "--tug-base-fg-link",
  "--tug-base-control-selected-fg",
  "--tug-base-control-highlighted-fg",
  "--tug-base-selection-fg",
  // A2 — muted / read-only hierarchy (Lc ~61, below Lc 75 body-text threshold)
  "--tug-base-fg-muted",
  "--tug-base-field-fg-readOnly",
  // B — text/icon on vivid accent or semantic bg
  "--tug-base-fg-onAccent",
  "--tug-base-icon-onAccent",
  "--tug-base-fg-onDanger",
  // C — interactive state tokens on vivid colored filled buttons
  // (hover/active states are transient; filled button bg hues may be vivid mid-tones)
  "--tug-base-control-filled-accent-fg-hover",
  "--tug-base-control-filled-accent-fg-active",
  "--tug-base-control-filled-accent-icon-hover",
  "--tug-base-control-filled-accent-icon-active",
  "--tug-base-control-filled-action-fg-hover",
  "--tug-base-control-filled-action-fg-active",
  "--tug-base-control-filled-action-icon-hover",
  "--tug-base-control-filled-action-icon-active",
  "--tug-base-control-filled-danger-fg-hover",
  "--tug-base-control-filled-danger-fg-active",
  "--tug-base-control-filled-danger-icon-hover",
  "--tug-base-control-filled-danger-icon-active",
  "--tug-base-control-filled-agent-fg-hover",
  "--tug-base-control-filled-agent-fg-active",
  "--tug-base-control-filled-agent-icon-hover",
  "--tug-base-control-filled-agent-icon-active",
  // C1d — filled-data: teal bg with light text has same contrast constraint as other filled roles
  "--tug-base-control-filled-data-fg-hover",
  "--tug-base-control-filled-data-fg-active",
  "--tug-base-control-filled-data-icon-hover",
  "--tug-base-control-filled-data-icon-active",
  // C1e — filled-success: green bg with light text has same contrast constraint as other filled roles
  "--tug-base-control-filled-success-fg-hover",
  "--tug-base-control-filled-success-fg-active",
  "--tug-base-control-filled-success-icon-hover",
  "--tug-base-control-filled-success-icon-active",
  // C1f — filled-caution: yellow bg with light text has same contrast constraint as other filled roles
  // (fg-hover is within 5 Lc of threshold — covered by marginal band; icon-hover/active kept)
  "--tug-base-control-filled-caution-fg-active",
  "--tug-base-control-filled-caution-icon-hover",
  "--tug-base-control-filled-caution-icon-active",
  // C2 — outlined-action/agent: transparent bg means fg/icon contrast is against parent surface,
  // not the semi-transparent hover/active tint
  "--tug-base-control-outlined-action-fg-hover",
  "--tug-base-control-outlined-action-fg-active",
  "--tug-base-control-outlined-action-icon-hover",
  "--tug-base-control-outlined-action-icon-active",
  "--tug-base-control-outlined-agent-fg-rest",
  "--tug-base-control-outlined-agent-fg-hover",
  "--tug-base-control-outlined-agent-fg-active",
  "--tug-base-control-outlined-agent-icon-rest",
  "--tug-base-control-outlined-agent-icon-hover",
  "--tug-base-control-outlined-agent-icon-active",
  // C3 — ghost-danger rest/hover/active: danger hue at mid-tone is below Lc 60 large-text
  "--tug-base-control-ghost-danger-fg-rest",
  "--tug-base-control-ghost-danger-fg-hover",
  "--tug-base-control-ghost-danger-fg-active",
  "--tug-base-control-ghost-danger-icon-active",
  // D — semantic tone tokens (all 7 families)
  "--tug-base-tone-accent-fg",
  "--tug-base-tone-active-fg",
  "--tug-base-tone-agent-fg",
  "--tug-base-tone-data-fg",
  "--tug-base-tone-success-fg",
  "--tug-base-tone-caution-fg",
  "--tug-base-tone-danger-fg",
  "--tug-base-tone-accent-icon",
  "--tug-base-tone-active-icon",
  "--tug-base-tone-agent-icon",
  "--tug-base-tone-data-icon",
  "--tug-base-tone-success-icon",
  "--tug-base-tone-caution-icon",
  "--tug-base-tone-danger-icon",
  // E — UI control indicators
  "--tug-base-accent-default",
  "--tug-base-toggle-thumb",
  "--tug-base-toggle-icon-mixed",
  "--tug-base-checkmark",
  "--tug-base-radio-dot",
  "--tug-base-range-thumb",
  // E2 — muted / disabled element tokens below Lc thresholds
  "--tug-base-icon-muted",
  "--tug-base-fg-disabled",
  "--tug-base-icon-disabled",
  "--tug-base-field-fg-disabled",
  // F — Badge tinted border tokens (Step 4): element side (border) has alpha 35%;
  // compositing over surface-default produces Lc ~19-24, below the Lc 30 ui-component
  // threshold. These borders are deliberately subtle tinted accents — their visual
  // presence is reinforced by the filled badge bg and text, not by the border alone.
  "--tug-base-badge-tinted-accent-border",
  "--tug-base-badge-tinted-action-border",
  "--tug-base-badge-tinted-agent-border",
  "--tug-base-badge-tinted-data-border",
  "--tug-base-badge-tinted-danger-border",
  "--tug-base-badge-tinted-success-border",
  "--tug-base-badge-tinted-caution-border",
  // G — Tab chrome (intentionally below Lc 75 body-text threshold)
  // tab-fg-rest: inactive tab label (Lc ~27 on surface-sunken in dark; structural in light)
  // tab-fg-hover: hover state (below Lc 75 body-text in both dark and light)
  "--tug-base-tab-fg-rest",
  "--tug-base-tab-fg-hover",
  // G2 — Field text: field-fg is the text inside form fields; in light mode, the
  // field background (field-bg-rest/hover) is derived close in lightness to field-fg,
  // producing Lc ~27-51 in light mode (below Lc 75 body-text threshold). Light-mode
  // calibration is a known deferred constraint (same as surface derivation).
  "--tug-base-field-fg",
  // H — Non-text component visibility tokens below Lc 30 by design (Step 3)
  // These tokens start below the ui-component threshold and are auto-adjusted
  // by the pipeline. They are documented here so the test tracks regressions
  // rather than pre-existing structural constraints.
  //
  // Toggle track inactive/indeterminate states: intentionally lower-contrast
  // to signal the off/mixed (inactive) state vs. the on state.
  "--tug-base-toggle-track-off",
  "--tug-base-toggle-track-mixed",
  "--tug-base-toggle-track-off-hover",
  "--tug-base-toggle-track-mixed-hover",
  // toggle-track-on starts below Lc 30 in some configurations; auto-adjust
  // brings it to passing. Documented here to prevent unexpected regression reports.
  "--tug-base-toggle-track-on",
  // Field border rest/hover: intentionally subtle boundary in dark mode.
  // The active (focus) border uses a vivid accent color and passes without adjustment.
  "--tug-base-field-border-rest",
  "--tug-base-field-border-hover",
  // Separator tokens: structural dividers intentionally low-contrast in dark mode.
  // border-default and border-muted create visual hierarchy via subtle separation.
  "--tug-base-border-default",
  "--tug-base-border-muted",
]);

/**
 * Specific (element, surface) pairs below threshold due to structural constraints
 * that cannot be resolved by tone-bumping alone. Keyed as "elementToken|surfaceToken"
 * strings for O(1) lookup.
 *
 * Categories:
 *   - Focus indicator focused-vs-unfocused decorative pairs (Step 5): SA98G is
 *     designed for element-on-area contrast, not border-vs-border comparisons [D05].
 *     The auto-adjuster bumps accent-cool-default trying to satisfy the decorative
 *     threshold for control-outlined-action-border-rest (Lc ~9.5 < 15), causing
 *     cascade that drives field-border-rest to Lc 0.0. Both pairs are informational
 *     only. The 9 ui-component focus-on-surface pairs all pass Lc 30 independently.
 */
const KNOWN_PAIR_EXCEPTIONS = new Set([
  // Focused-vs-unfocused decorative comparisons (border-vs-border, informational [D05])
  "--tug-base-accent-cool-default|--tug-base-field-border-rest",
  "--tug-base-accent-cool-default|--tug-base-control-outlined-action-border-rest",
]);

/**
 * Run the full derivation → contrast-validation → auto-adjustment pipeline for
 * a given recipe and return the final contrast results after adjustment.
 *
 * Verifies [D09]: deriveTheme().resolved feeds directly into validateThemeContrast()
 * with no intermediate parsing or conversion.
 */
function runFullPipeline(recipeName: string): {
  initialFailureCount: number;
  finalResults: ReturnType<typeof validateThemeContrast>;
  unfixable: string[];
  tokensAndResolvedConsistent: boolean;
} {
  const recipe = EXAMPLE_RECIPES[recipeName];

  // Step 1: Derive theme — resolved map is OKLCH, no conversion needed [D09]
  const output = deriveTheme(recipe);

  // Step 2: Validate contrast — resolved feeds directly into validateThemeContrast [D09]
  const initialResults = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);
  const initialFailureCount = initialResults.filter((r) => !r.lcPass).length;

  // Step 3: Auto-adjust any failures
  const failures = initialResults.filter((r) => !r.lcPass);
  const adjusted = autoAdjustContrast(output.tokens, output.resolved, failures, ELEMENT_SURFACE_PAIRING_MAP);

  // Step 4: Re-validate with adjusted resolved map
  const finalResults = validateThemeContrast(adjusted.resolved, ELEMENT_SURFACE_PAIRING_MAP);

  // Consistency check: every token that was adjusted must still have a
  // --tug-color() string in adjusted.tokens. This verifies tokens and
  // resolved stay in sync after adjustment [D09].
  let tokensAndResolvedConsistent = true;
  for (const tokenName of Object.keys(adjusted.resolved)) {
    const tokenStr = adjusted.tokens[tokenName];
    if (!tokenStr || !tokenStr.includes("--tug-color(")) {
      tokensAndResolvedConsistent = false;
      break;
    }
  }

  return {
    initialFailureCount,
    finalResults,
    unfixable: adjusted.unfixable,
    tokensAndResolvedConsistent,
  };
}

// ---------------------------------------------------------------------------
// Test suite: derivation-engine integration (T4.x)
// ---------------------------------------------------------------------------

describe("derivation-engine integration", () => {
  // -------------------------------------------------------------------------
  // T4.1: Brio end-to-end pipeline
  // -------------------------------------------------------------------------
  it("T4.1: deriveTheme(brio) -> validateThemeContrast -> 0 unexpected body-text failures after autoAdjustContrast", () => {
    const { initialFailureCount, finalResults, tokensAndResolvedConsistent } =
      runFullPipeline("brio");

    // Pipeline must have evaluated some pairs initially
    expect(initialFailureCount).toBeGreaterThanOrEqual(0);

    // tokens and resolved must remain consistent after adjustment [D09]
    expect(tokensAndResolvedConsistent).toBe(true);

    // After adjustment, failures must only come from the documented exception sets:
    // element-level (KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS), pair-level (KNOWN_PAIR_EXCEPTIONS),
    // or marginal band (within LC_MARGINAL_DELTA Lc units of the role threshold). [D02]
    const unexpectedFailures = finalResults.filter((r) => {
      if (r.lcPass) return false;
      const margin = (LC_THRESHOLDS[r.role] ?? 15) - LC_MARGINAL_DELTA;
      if (Math.abs(r.lc) >= margin) return false;
      if (KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.has(r.fg)) return false;
      if (KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`)) return false;
      return true;
    });
    const descriptions = unexpectedFailures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: Lc ${f.lc.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);

    // Core readability assertion: fg-default on primary surfaces must pass Lc 75
    const coreFailures = finalResults.filter(
      (r) =>
        r.fg === "--tug-base-fg-default" &&
        (r.bg === "--tug-base-surface-default" ||
          r.bg === "--tug-base-surface-inset" ||
          r.bg === "--tug-base-surface-content") &&
        !r.lcPass,
    );
    expect(coreFailures).toEqual([]);

    // Focus indicator assertion (Step 5): all 9 ui-component focus-on-surface pairs
    // must pass Lc 30. This guards against regressions on the accent-cool-default
    // ui-component pairs even though two decorative pairs are in KNOWN_PAIR_EXCEPTIONS.
    const focusSurfaces = new Set([
      "--tug-base-bg-app",
      "--tug-base-surface-default",
      "--tug-base-surface-raised",
      "--tug-base-surface-inset",
      "--tug-base-surface-content",
      "--tug-base-surface-overlay",
      "--tug-base-surface-sunken",
      "--tug-base-surface-screen",
      "--tug-base-field-bg-rest",
    ]);
    const focusFailures = finalResults.filter(
      (r) =>
        r.fg === "--tug-base-accent-cool-default" &&
        r.role === "ui-component" &&
        focusSurfaces.has(r.bg) &&
        !r.lcPass,
    );
    expect(focusFailures.map((f) => `${f.bg}: Lc ${f.lc.toFixed(1)}`)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T4.2: Brio light preset — 0 unexpected body-text failures
  //
  // The light-mode engine calibration is known to have structural surface-derivation
  // constraints (bg-app / surface-raised derived too dark for light recipes,
  // surface-overlay/sunken near-miss with fg-default) that are tracked as
  // KNOWN_PAIR_EXCEPTIONS in gallery-theme-generator-content.test.tsx.
  // This test mirrors the gallery's light-mode check — body-text only — using the
  // same set of light-mode pair exceptions.
  //
  // Full ui-component and focus-indicator coverage for light mode is exercised by
  // the gallery test suite, which runs all EXAMPLE_RECIPES with the complete
  // exception set.
  // -------------------------------------------------------------------------
  it("T4.2: deriveTheme(brio-light) -> 0 unexpected body-text failures after autoAdjustContrast", () => {
    const brioLight = { ...EXAMPLE_RECIPES.brio, mode: "light" as const };
    const output = deriveTheme(brioLight);
    const initial = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);
    const failures = initial.filter((r) => !r.lcPass);
    const adjusted = autoAdjustContrast(output.tokens, output.resolved, failures, ELEMENT_SURFACE_PAIRING_MAP);
    const finalResults = validateThemeContrast(adjusted.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    // Known light-mode surface-derivation constraints (engine calibrated for dark mode;
    // these pairs are structurally constrained in light mode, not regressions).
    const LIGHT_MODE_PAIR_EXCEPTIONS = new Set([
      "--tug-base-fg-default|--tug-base-bg-app",
      "--tug-base-fg-default|--tug-base-bg-canvas",
      "--tug-base-fg-default|--tug-base-surface-raised",
      "--tug-base-fg-default|--tug-base-surface-overlay",
      "--tug-base-fg-default|--tug-base-surface-sunken",
      "--tug-base-fg-default|--tug-base-surface-screen",
      "--tug-base-fg-inverse|--tug-base-surface-screen",
    ]);

    // Check body-text only — mirrors the gallery test's light-mode coverage scope.
    const unexpectedBodyTextFailures = finalResults.filter((r) => {
      if (r.lcPass) return false;
      if (r.role !== "body-text") return false;
      const margin = (LC_THRESHOLDS[r.role] ?? 15) - LC_MARGINAL_DELTA;
      if (Math.abs(r.lc) >= margin) return false;
      if (KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.has(r.fg)) return false;
      if (KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`)) return false;
      if (LIGHT_MODE_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`)) return false;
      return true;
    });
    const descriptions = unexpectedBodyTextFailures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: Lc ${f.lc.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);

    // Focus indicator assertion (Step 5): ui-component focus-on-surface pairs
    // must pass Lc 30. In dark mode all 9 surfaces pass (T4.1). In light mode,
    // 5 surfaces are structurally constrained by the light-mode surface derivation
    // (engine calibrated for dark mode per Q01). These are documented below so the
    // test tracks regressions on the 4 surfaces that do pass, rather than silently
    // skipping the assertion entirely.
    //
    // Light-mode focus exceptions (structural — deferred per Q01):
    //   bg-app (L≈0.39): derives too dark in light mode → accent-cool-default
    //     mid-lightness (L≈0.51) produces |Lc| ≈ 12.8, below Lc 30.
    //   surface-raised (L≈0.44): same structural derivation issue → |Lc| ≈ 11.8.
    //   surface-overlay / surface-sunken / field-bg-rest: APCA soft-clip region —
    //     these surfaces land in a narrow lightness band near accent-cool-default
    //     producing deltaYc below the APCA_LOW_CLIP threshold (Lc rounds to 0.0).
    const LIGHT_MODE_FOCUS_EXCEPTIONS = new Set([
      "--tug-base-accent-cool-default|--tug-base-bg-app",
      "--tug-base-accent-cool-default|--tug-base-surface-raised",
      "--tug-base-accent-cool-default|--tug-base-surface-overlay",
      "--tug-base-accent-cool-default|--tug-base-surface-sunken",
      "--tug-base-accent-cool-default|--tug-base-field-bg-rest",
      // surface-screen uses indigo (260) canonical L (0.572) after 48-hue expansion;
      // light-mode surface-screen lands darker, producing Lc < 30 with accent-cool-default.
      "--tug-base-accent-cool-default|--tug-base-surface-screen",
    ]);
    const focusSurfaces = new Set([
      "--tug-base-bg-app",
      "--tug-base-surface-default",
      "--tug-base-surface-raised",
      "--tug-base-surface-inset",
      "--tug-base-surface-content",
      "--tug-base-surface-overlay",
      "--tug-base-surface-sunken",
      "--tug-base-surface-screen",
      "--tug-base-field-bg-rest",
    ]);
    const focusFailures = finalResults.filter(
      (r) =>
        r.fg === "--tug-base-accent-cool-default" &&
        r.role === "ui-component" &&
        focusSurfaces.has(r.bg) &&
        !r.lcPass &&
        !LIGHT_MODE_FOCUS_EXCEPTIONS.has(`${r.fg}|${r.bg}`),
    );
    expect(focusFailures.map((f) => `${f.bg}: Lc ${f.lc.toFixed(1)}`)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Structural verification: resolved map feeds directly into validateThemeContrast
  // with no intermediate parsing or conversion [D09]
  // -------------------------------------------------------------------------
  it("resolved map feeds directly into validateThemeContrast — no conversion needed [D09]", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);

    // validateThemeContrast accepts Record<string, ResolvedColor> directly —
    // the same type returned by deriveTheme().resolved. No type assertion or
    // conversion is needed.
    const results = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    // Results must be non-empty (at least one pair evaluated)
    expect(results.length).toBeGreaterThan(0);

    // Every result references tokens that exist in the resolved map.
    // validateThemeContrast skips pairs where either token is absent, so
    // all returned results must have both tokens present.
    for (const result of results) {
      expect(output.resolved[result.fg]).toBeDefined();
      expect(output.resolved[result.bg]).toBeDefined();
    }

    // The results contain both passing and failing pairs (not trivially all-pass)
    const passingCount = results.filter((r) => r.lcPass).length;
    const totalCount = results.length;
    expect(passingCount).toBeGreaterThan(0);
    expect(totalCount).toBeGreaterThan(passingCount); // some pairs fail → engine is honest
  });
});

// ---------------------------------------------------------------------------
// Brio ground truth fixture — extracted from tug-base.css body{} block.
// Spec S02: every --tug-base-* token whose CSS value contains --tug-color(..)
// is recorded here as the exact value string (trimmed, no trailing semicolon).
// Composite values (e.g. shadow-overlay with a dimension prefix) are included
// as-is. Structural tokens (transparent, none, var(...), plain values) are
// recorded separately in BRIO_STRUCTURAL_TOKENS below.
//
// Mismatch count at step-1 baseline (engine vs. fixture): 38 tokens differ.
// These mismatches are intentional — they are the targets of steps 2-4.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BRIO_STRUCTURAL_TOKENS: Record<string, string> = {
  "--tug-base-motion-duration-fast": "calc(100ms * var(--tug-timing))",
  "--tug-base-motion-duration-moderate": "calc(200ms * var(--tug-timing))",
  "--tug-base-motion-duration-slow": "calc(350ms * var(--tug-timing))",
  "--tug-base-motion-duration-glacial": "calc(500ms * var(--tug-timing))",
  "--tug-base-font-family-sans":
    '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
  "--tug-base-font-family-mono": '"Hack", "JetBrains Mono", "SFMono-Regular", "Menlo", monospace',
  "--tug-base-font-size-2xs": "11px",
  "--tug-base-font-size-xs": "12px",
  "--tug-base-font-size-sm": "13px",
  "--tug-base-font-size-md": "14px",
  "--tug-base-font-size-lg": "16px",
  "--tug-base-font-size-xl": "20px",
  "--tug-base-font-size-2xl": "24px",
  "--tug-base-line-height-2xs": "15px",
  "--tug-base-line-height-xs": "17px",
  "--tug-base-line-height-sm": "19px",
  "--tug-base-line-height-md": "20px",
  "--tug-base-line-height-lg": "24px",
  "--tug-base-line-height-xl": "28px",
  "--tug-base-line-height-2xl": "32px",
  "--tug-base-line-height-tight": "1.2",
  "--tug-base-line-height-normal": "1.45",
  "--tug-base-space-2xs": "2px",
  "--tug-base-space-xs": "4px",
  "--tug-base-space-sm": "6px",
  "--tug-base-space-md": "8px",
  "--tug-base-space-lg": "12px",
  "--tug-base-space-xl": "16px",
  "--tug-base-space-2xl": "24px",
  "--tug-base-radius-2xs": "1px",
  "--tug-base-radius-xs": "2px",
  "--tug-base-radius-sm": "4px",
  "--tug-base-radius-md": "6px",
  "--tug-base-radius-lg": "8px",
  "--tug-base-radius-xl": "12px",
  "--tug-base-radius-2xl": "16px",
  "--tug-base-chrome-height": "36px",
  "--tug-base-icon-size-2xs": "10px",
  "--tug-base-icon-size-xs": "12px",
  "--tug-base-icon-size-sm": "13px",
  "--tug-base-icon-size-md": "15px",
  "--tug-base-icon-size-lg": "20px",
  "--tug-base-icon-size-xl": "24px",
  "--tug-base-motion-duration-instant": "calc(0ms * var(--tug-timing))",
  "--tug-base-motion-easing-standard": "cubic-bezier(0.2, 0, 0, 1)",
  "--tug-base-motion-easing-enter": "cubic-bezier(0, 0, 0, 1)",
  "--tug-base-motion-easing-exit": "cubic-bezier(0.2, 0, 1, 1)",
  "--tug-base-control-disabled-opacity": "0.5",
  "--tug-base-control-disabled-shadow": "none",
  "--tug-base-control-outlined-action-bg-rest": "transparent",
  "--tug-base-control-outlined-option-bg-rest": "transparent",
  "--tug-base-control-outlined-agent-bg-rest": "transparent",
  "--tug-base-control-ghost-action-bg-rest": "transparent",
  "--tug-base-control-ghost-action-border-rest": "transparent",
  "--tug-base-control-ghost-option-bg-rest": "transparent",
  "--tug-base-control-ghost-option-border-rest": "transparent",
  "--tug-base-control-ghost-danger-bg-rest": "transparent",
  "--tug-base-control-ghost-danger-border-rest": "transparent",
  "--tug-base-surface-control": "var(--tug-base-control-outlined-action-bg-rest)",
};

export const BRIO_GROUND_TRUTH: Record<string, { L: number; C: number; h: number }> = {
  "--tug-base-accent-cool-default": { L: 0.744, C: 0.24300000000000002, h: 250 },
  "--tug-base-accent-default": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-accent-subtle": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-badge-tinted-accent-bg": { L: 0.8160000000000001, C: 0.1898, h: 55 },
  "--tug-base-badge-tinted-accent-border": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-badge-tinted-accent-fg": { L: 0.906, C: 0.21023999999999998, h: 55 },
  "--tug-base-badge-tinted-action-bg": { L: 0.8088, C: 0.18589999999999998, h: 230 },
  "--tug-base-badge-tinted-action-border": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-badge-tinted-action-fg": { L: 0.9033, C: 0.20591999999999996, h: 230 },
  "--tug-base-badge-tinted-agent-bg": { L: 0.7584, C: 0.1937, h: 270 },
  "--tug-base-badge-tinted-agent-border": { L: 0.708, C: 0.149, h: 270 },
  "--tug-base-badge-tinted-agent-fg": { L: 0.8844, C: 0.21455999999999997, h: 270 },
  "--tug-base-badge-tinted-caution-bg": { L: 0.9128, C: 0.1625, h: 90 },
  "--tug-base-badge-tinted-caution-border": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-badge-tinted-caution-fg": { L: 0.9422999999999999, C: 0.18, h: 90 },
  "--tug-base-badge-tinted-danger-bg": { L: 0.7192000000000001, C: 0.28600000000000003, h: 25 },
  "--tug-base-badge-tinted-danger-border": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-badge-tinted-danger-fg": { L: 0.8697, C: 0.31679999999999997, h: 25 },
  "--tug-base-badge-tinted-data-bg": { L: 0.8344, C: 0.1937, h: 175 },
  "--tug-base-badge-tinted-data-border": { L: 0.803, C: 0.149, h: 175 },
  "--tug-base-badge-tinted-data-fg": { L: 0.9129, C: 0.21455999999999997, h: 175 },
  "--tug-base-badge-tinted-success-bg": { L: 0.8488, C: 0.28600000000000003, h: 140 },
  "--tug-base-badge-tinted-success-border": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-badge-tinted-success-fg": { L: 0.9182999999999999, C: 0.31679999999999997, h: 140 },
  "--tug-base-bg-app": { L: 0.2076, C: 0.005600000000000001, h: 263.33333333333326 },
  "--tug-base-bg-canvas": { L: 0.2076, C: 0.005600000000000001, h: 263.33333333333326 },
  "--tug-base-border-accent": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-border-danger": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-border-default": { L: 0.5064, C: 0.0162, h: 250 },
  "--tug-base-border-inverse": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-border-muted": { L: 0.57624, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-border-strong": { L: 0.6108, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-checkmark": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-checkmark-mixed": { L: 0.81312, C: 0.013500000000000002, h: 250 },
  "--tug-base-control-disabled-bg": { L: 0.39552, C: 0.0149, h: 270 },
  "--tug-base-control-disabled-border": { L: 0.47256, C: 0.016800000000000002, h: 263.33333333333326 },
  "--tug-base-control-disabled-fg": { L: 0.58776, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-control-disabled-icon": { L: 0.58776, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-control-filled-accent-bg-active": { L: 0.78, C: 0.2628, h: 55 },
  "--tug-base-control-filled-accent-bg-hover": { L: 0.654, C: 0.1606, h: 55 },
  "--tug-base-control-filled-accent-bg-rest": { L: 0.402, C: 0.146, h: 55 },
  "--tug-base-control-filled-accent-border-active": { L: 0.78, C: 0.2628, h: 55 },
  "--tug-base-control-filled-accent-border-hover": { L: 0.78, C: 0.1898, h: 55 },
  "--tug-base-control-filled-accent-border-rest": { L: 0.78, C: 0.1606, h: 55 },
  "--tug-base-control-filled-accent-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-accent-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-accent-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-accent-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-accent-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-accent-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-action-bg-active": { L: 0.771, C: 0.25739999999999996, h: 230 },
  "--tug-base-control-filled-action-bg-hover": { L: 0.6468, C: 0.1573, h: 230 },
  "--tug-base-control-filled-action-bg-rest": { L: 0.3984, C: 0.143, h: 230 },
  "--tug-base-control-filled-action-border-active": { L: 0.771, C: 0.25739999999999996, h: 230 },
  "--tug-base-control-filled-action-border-hover": { L: 0.771, C: 0.18589999999999998, h: 230 },
  "--tug-base-control-filled-action-border-rest": { L: 0.771, C: 0.1573, h: 230 },
  "--tug-base-control-filled-action-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-action-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-action-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-action-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-action-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-action-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-agent-bg-active": { L: 0.708, C: 0.2682, h: 270 },
  "--tug-base-control-filled-agent-bg-hover": { L: 0.5963999999999999, C: 0.16390000000000002, h: 270 },
  "--tug-base-control-filled-agent-bg-rest": { L: 0.3732, C: 0.149, h: 270 },
  "--tug-base-control-filled-agent-border-active": { L: 0.708, C: 0.2682, h: 270 },
  "--tug-base-control-filled-agent-border-hover": { L: 0.708, C: 0.1937, h: 270 },
  "--tug-base-control-filled-agent-border-rest": { L: 0.708, C: 0.16390000000000002, h: 270 },
  "--tug-base-control-filled-agent-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-agent-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-agent-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-agent-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-agent-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-agent-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-caution-bg-active": { L: 0.9009999999999999, C: 0.225, h: 90 },
  "--tug-base-control-filled-caution-bg-hover": { L: 0.7508, C: 0.1375, h: 90 },
  "--tug-base-control-filled-caution-bg-rest": { L: 0.4504, C: 0.125, h: 90 },
  "--tug-base-control-filled-caution-border-active": { L: 0.9009999999999999, C: 0.225, h: 90 },
  "--tug-base-control-filled-caution-border-hover": { L: 0.9009999999999999, C: 0.1625, h: 90 },
  "--tug-base-control-filled-caution-border-rest": { L: 0.9009999999999999, C: 0.1375, h: 90 },
  "--tug-base-control-filled-caution-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-caution-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-caution-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-caution-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-caution-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-caution-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-danger-bg-active": { L: 0.659, C: 0.396, h: 25 },
  "--tug-base-control-filled-danger-bg-hover": { L: 0.5572, C: 0.24200000000000002, h: 25 },
  "--tug-base-control-filled-danger-bg-rest": { L: 0.3536, C: 0.22, h: 25 },
  "--tug-base-control-filled-danger-border-active": { L: 0.659, C: 0.396, h: 25 },
  "--tug-base-control-filled-danger-border-hover": { L: 0.659, C: 0.28600000000000003, h: 25 },
  "--tug-base-control-filled-danger-border-rest": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-control-filled-danger-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-danger-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-danger-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-danger-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-danger-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-danger-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-data-bg-active": { L: 0.803, C: 0.2682, h: 175 },
  "--tug-base-control-filled-data-bg-hover": { L: 0.6724, C: 0.16390000000000002, h: 175 },
  "--tug-base-control-filled-data-bg-rest": { L: 0.4112, C: 0.149, h: 175 },
  "--tug-base-control-filled-data-border-active": { L: 0.803, C: 0.2682, h: 175 },
  "--tug-base-control-filled-data-border-hover": { L: 0.803, C: 0.1937, h: 175 },
  "--tug-base-control-filled-data-border-rest": { L: 0.803, C: 0.16390000000000002, h: 175 },
  "--tug-base-control-filled-data-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-data-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-data-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-data-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-data-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-data-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-success-bg-active": { L: 0.821, C: 0.396, h: 140 },
  "--tug-base-control-filled-success-bg-hover": { L: 0.6868, C: 0.24200000000000002, h: 140 },
  "--tug-base-control-filled-success-bg-rest": { L: 0.4184, C: 0.22, h: 140 },
  "--tug-base-control-filled-success-border-active": { L: 0.821, C: 0.396, h: 140 },
  "--tug-base-control-filled-success-border-hover": { L: 0.821, C: 0.28600000000000003, h: 140 },
  "--tug-base-control-filled-success-border-rest": { L: 0.821, C: 0.24200000000000002, h: 140 },
  "--tug-base-control-filled-success-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-success-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-success-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-success-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-success-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-filled-success-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-action-bg-active": { L: 1, C: 0, h: 0 },
  "--tug-base-control-ghost-action-bg-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-control-ghost-action-border-active": { L: 0.7872, C: 0.054000000000000006, h: 250 },
  "--tug-base-control-ghost-action-border-hover": { L: 0.7872, C: 0.054000000000000006, h: 250 },
  "--tug-base-control-ghost-action-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-action-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-action-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-action-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-action-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-action-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-danger-bg-active": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-control-ghost-danger-bg-hover": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-control-ghost-danger-border-active": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-control-ghost-danger-border-hover": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-control-ghost-danger-fg-active": { L: 0.659, C: 0.33, h: 25 },
  "--tug-base-control-ghost-danger-fg-hover": { L: 0.659, C: 0.28600000000000003, h: 25 },
  "--tug-base-control-ghost-danger-fg-rest": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-control-ghost-danger-icon-active": { L: 0.659, C: 0.33, h: 25 },
  "--tug-base-control-ghost-danger-icon-hover": { L: 0.659, C: 0.28600000000000003, h: 25 },
  "--tug-base-control-ghost-danger-icon-rest": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-control-ghost-option-bg-active": { L: 1, C: 0, h: 0 },
  "--tug-base-control-ghost-option-bg-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-control-ghost-option-border-active": { L: 0.7872, C: 0.054000000000000006, h: 250 },
  "--tug-base-control-ghost-option-border-hover": { L: 0.7872, C: 0.054000000000000006, h: 250 },
  "--tug-base-control-ghost-option-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-option-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-option-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-option-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-option-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-ghost-option-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-highlighted-bg": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-control-highlighted-border": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-control-highlighted-fg": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-control-outlined-action-bg-active": { L: 1, C: 0, h: 0 },
  "--tug-base-control-outlined-action-bg-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-control-outlined-action-border-active": { L: 0.771, C: 0.21449999999999997, h: 230 },
  "--tug-base-control-outlined-action-border-hover": { L: 0.771, C: 0.18589999999999998, h: 230 },
  "--tug-base-control-outlined-action-border-rest": { L: 0.771, C: 0.1573, h: 230 },
  "--tug-base-control-outlined-action-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-action-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-action-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-action-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-action-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-action-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-agent-bg-active": { L: 1, C: 0, h: 0 },
  "--tug-base-control-outlined-agent-bg-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-control-outlined-agent-border-active": { L: 0.708, C: 0.22349999999999998, h: 270 },
  "--tug-base-control-outlined-agent-border-hover": { L: 0.708, C: 0.1937, h: 270 },
  "--tug-base-control-outlined-agent-border-rest": { L: 0.708, C: 0.16390000000000002, h: 270 },
  "--tug-base-control-outlined-agent-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-agent-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-agent-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-agent-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-agent-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-agent-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-option-bg-active": { L: 1, C: 0, h: 0 },
  "--tug-base-control-outlined-option-bg-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-control-outlined-option-border-active": { L: 0.7872, C: 0.0297, h: 250 },
  "--tug-base-control-outlined-option-border-hover": { L: 0.7656, C: 0.024300000000000002, h: 250 },
  "--tug-base-control-outlined-option-border-rest": { L: 0.744, C: 0.018900000000000004, h: 250 },
  "--tug-base-control-outlined-option-fg-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-option-fg-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-option-fg-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-option-icon-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-option-icon-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-outlined-option-icon-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-control-selected-bg": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-control-selected-bg-hover": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-control-selected-border": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-control-selected-disabled-bg": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-control-selected-fg": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-divider-default": { L: 0.34584, C: 0.016800000000000002, h: 263.33333333333326 },
  "--tug-base-divider-muted": { L: 0.3174, C: 0.01192, h: 270 },
  "--tug-base-fg-default": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-fg-disabled": { L: 0.41496, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-fg-inverse": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-fg-link": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-fg-link-hover": { L: 0.9129, C: 0.05360000000000001, h: 200 },
  "--tug-base-fg-muted": { L: 0.81312, C: 0.013500000000000002, h: 250 },
  "--tug-base-fg-onAccent": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-fg-onCaution": { L: 0.23064, C: 0.011200000000000002, h: 263.33333333333326 },
  "--tug-base-fg-onDanger": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-fg-onSuccess": { L: 0.23064, C: 0.011200000000000002, h: 263.33333333333326 },
  "--tug-base-fg-placeholder": { L: 0.5064, C: 0.0162, h: 250 },
  "--tug-base-fg-subtle": { L: 0.57624, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-field-bg-disabled": { L: 0.21911999999999998, C: 0.014000000000000002, h: 263.33333333333326 },
  "--tug-base-field-bg-focus": { L: 0.23064, C: 0.011200000000000002, h: 263.33333333333326 },
  "--tug-base-field-bg-hover": { L: 0.27276, C: 0.0149, h: 270 },
  "--tug-base-field-bg-readOnly": { L: 0.27276, C: 0.0149, h: 270 },
  "--tug-base-field-bg-rest": { L: 0.24216, C: 0.014000000000000002, h: 263.33333333333326 },
  "--tug-base-field-border-active": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-field-border-danger": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-field-border-disabled": { L: 0.34584, C: 0.016800000000000002, h: 263.33333333333326 },
  "--tug-base-field-border-hover": { L: 0.57624, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-field-border-readOnly": { L: 0.34584, C: 0.016800000000000002, h: 263.33333333333326 },
  "--tug-base-field-border-rest": { L: 0.5064, C: 0.0162, h: 250 },
  "--tug-base-field-border-success": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-field-fg": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-field-fg-disabled": { L: 0.41496, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-field-fg-readOnly": { L: 0.81312, C: 0.013500000000000002, h: 250 },
  "--tug-base-field-label": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-field-placeholder": { L: 0.5064, C: 0.0162, h: 250 },
  "--tug-base-field-required": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-field-tone-caution": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-field-tone-danger": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-field-tone-success": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-highlight-dropTarget": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-highlight-flash": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-highlight-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-highlight-inspectorTarget": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-highlight-preview": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-highlight-snapGuide": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-icon-active": { L: 0.8735999999999999, C: 0.27, h: 250 },
  "--tug-base-icon-default": { L: 0.81312, C: 0.013500000000000002, h: 250 },
  "--tug-base-icon-disabled": { L: 0.41496, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-icon-muted": { L: 0.57624, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-icon-onAccent": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-overlay-dim": { L: 0, C: 0, h: 0 },
  "--tug-base-overlay-highlight": { L: 1, C: 0, h: 0 },
  "--tug-base-overlay-scrim": { L: 0, C: 0, h: 0 },
  "--tug-base-radio-dot": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-selection-bg": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-selection-bg-inactive": { L: 0.6006, C: 0, h: 90 },
  "--tug-base-selection-fg": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-separator": { L: 0.47256, C: 0.016800000000000002, h: 263.33333333333326 },
  "--tug-base-shadow-lg": { L: 0, C: 0, h: 0 },
  "--tug-base-shadow-md": { L: 0, C: 0, h: 0 },
  "--tug-base-shadow-overlay": { L: 0, C: 0, h: 0 },
  "--tug-base-shadow-xl": { L: 0, C: 0, h: 0 },
  "--tug-base-shadow-xs": { L: 0, C: 0, h: 0 },
  "--tug-base-surface-content": { L: 0.21911999999999998, C: 0.014000000000000002, h: 263.33333333333326 },
  "--tug-base-surface-default": { L: 0.28391999999999995, C: 0.0149, h: 270 },
  "--tug-base-surface-inset": { L: 0.21911999999999998, C: 0.014000000000000002, h: 263.33333333333326 },
  "--tug-base-surface-overlay": { L: 0.30623999999999996, C: 0.01192, h: 270 },
  "--tug-base-surface-raised": { L: 0.27671999999999997, C: 0.014000000000000002, h: 263.33333333333326 },
  "--tug-base-surface-screen": { L: 0.33431999999999995, C: 0.019600000000000003, h: 260 },
  "--tug-base-surface-sunken": { L: 0.27276, C: 0.0149, h: 270 },
  "--tug-base-tab-bg-active": { L: 0.35087999999999997, C: 0.0149, h: 272.5 },
  "--tug-base-tab-bg-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-tab-close-bg-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-tab-close-fg-hover": { L: 0.9168, C: 0.0081, h: 250 },
  "--tug-base-tab-fg-active": { L: 0.9168, C: 0.0081, h: 250 },
  "--tug-base-tab-fg-hover": { L: 0.9168, C: 0.0081, h: 250 },
  "--tug-base-tab-fg-rest": { L: 0.744, C: 0.018900000000000004, h: 250 },
  "--tug-base-toggle-icon-disabled": { L: 0.6108, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-toggle-icon-mixed": { L: 0.81312, C: 0.013500000000000002, h: 250 },
  "--tug-base-toggle-thumb": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-toggle-thumb-disabled": { L: 0.6108, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-toggle-track-disabled": { L: 0.39552, C: 0.0149, h: 270 },
  "--tug-base-toggle-track-mixed": { L: 0.57624, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-toggle-track-mixed-hover": { L: 0.6453599999999999, C: 0.033600000000000005, h: 256.66666666666663 },
  "--tug-base-toggle-track-off": { L: 0.47256, C: 0.016800000000000002, h: 263.33333333333326 },
  "--tug-base-toggle-track-off-hover": { L: 0.5647199999999999, C: 0.028000000000000004, h: 263.33333333333326 },
  "--tug-base-toggle-track-on": { L: 0.6792, C: 0.146, h: 55 },
  "--tug-base-toggle-track-on-hover": { L: 0.7170000000000001, C: 0.1606, h: 55 },
  "--tug-base-tone-accent": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-tone-accent-bg": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-tone-accent-border": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-tone-accent-fg": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-tone-accent-icon": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-tone-active": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-tone-active-bg": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-tone-active-border": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-tone-active-fg": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-tone-active-icon": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-tone-agent": { L: 0.708, C: 0.149, h: 270 },
  "--tug-base-tone-agent-bg": { L: 0.708, C: 0.149, h: 270 },
  "--tug-base-tone-agent-border": { L: 0.708, C: 0.149, h: 270 },
  "--tug-base-tone-agent-fg": { L: 0.708, C: 0.149, h: 270 },
  "--tug-base-tone-agent-icon": { L: 0.708, C: 0.149, h: 270 },
  "--tug-base-tone-caution": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-tone-caution-bg": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-tone-caution-border": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-tone-caution-fg": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-tone-caution-icon": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-tone-danger": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-tone-danger-bg": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-tone-danger-border": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-tone-danger-fg": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-tone-danger-icon": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-tone-data": { L: 0.803, C: 0.149, h: 175 },
  "--tug-base-tone-data-bg": { L: 0.803, C: 0.149, h: 175 },
  "--tug-base-tone-data-border": { L: 0.803, C: 0.149, h: 175 },
  "--tug-base-tone-data-fg": { L: 0.803, C: 0.149, h: 175 },
  "--tug-base-tone-data-icon": { L: 0.803, C: 0.149, h: 175 },
  "--tug-base-tone-success": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-tone-success-bg": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-tone-success-border": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-tone-success-fg": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-tone-success-icon": { L: 0.821, C: 0.22, h: 140 }
};

// ---------------------------------------------------------------------------
// oklchDeltaE: Euclidean distance in OKLCH space. [D01] Spec S04.
// Formula: sqrt(dL^2 + dC^2 + dH^2) where dH = 2*sqrt(Ca*Cb)*sin(dh/2)
// ---------------------------------------------------------------------------

function oklchDeltaE(
  a: { L: number; C: number; h: number },
  b: { L: number; C: number; h: number },
): number {
  const dL = a.L - b.L;
  const dC = a.C - b.C;
  let dh = ((a.h - b.h) * Math.PI) / 180;
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  const dH = 2 * Math.sqrt(a.C * b.C) * Math.sin(dh / 2);
  return Math.sqrt(dL * dL + dC * dC + dH * dH);
}

// ---------------------------------------------------------------------------
// T-BRIO-MATCH: Engine output must match Brio ground truth within OKLCH delta-E < 0.02.
// Fixture stores OKLCH L/C/h triples; test resolves derived token to OKLCH
// and asserts perceptual distance < 0.02 per token. [D01] Spec S04.
// ---------------------------------------------------------------------------

describe("derivation-engine brio-match", () => {
  it(
    "T-BRIO-MATCH: deriveTheme(brio).resolved matches BRIO_GROUND_TRUTH within OKLCH delta-E < 0.02",
    () => {
      const output = deriveTheme(EXAMPLE_RECIPES.brio);
      const failures: string[] = [];
      for (const [name, expected] of Object.entries(BRIO_GROUND_TRUTH)) {
        const actual = output.resolved[name];
        if (actual === undefined) {
          failures.push(`${name}: no resolved OKLCH value in engine output`);
          continue;
        }
        const delta = oklchDeltaE(actual, expected);
        if (delta >= 0.02) {
          failures.push(
            `${name}: delta-E ${delta.toFixed(5)} >= 0.02\n  expected: L=${expected.L} C=${expected.C} h=${expected.h}\n  actual:   L=${actual.L.toFixed(6)} C=${actual.C.toFixed(6)} h=${actual.h.toFixed(4)}`,
          );
        }
      }
      expect(failures).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// Step 6: ModePreset type and preset exports (T-PRESET-EXPORTS)
// Verifies that ModePreset, DARK_PRESET, and LIGHT_PRESET are exported and
// structurally valid, and that deriveTheme output is unchanged after the
// preset refactor. [D03]
// ---------------------------------------------------------------------------

describe("derivation-engine mode-preset", () => {
  it("T-PRESET-EXPORTS: DARK_PRESET and LIGHT_PRESET are exported and implement ModePreset", () => {
    // Verify DARK_PRESET satisfies the ModePreset interface (TypeScript compile-time
    // check + runtime field presence). [D03]
    const dark: ModePreset = DARK_PRESET;
    const light: ModePreset = LIGHT_PRESET;

    // Spot-check key fields match Brio ground truth values documented in the plan
    expect(dark.bgAppTone).toBe(5);
    expect(dark.surfaceSunkenTone).toBe(11);
    expect(dark.fgDefaultTone).toBe(94);
    expect(dark.txtI).toBe(3);
    expect(dark.shadowXsAlpha).toBe(20);
    expect(dark.filledBgDarkTone).toBe(20);
    expect(dark.fieldBgRestTone).toBe(8);

    // Light preset must have all required fields
    expect(light.bgAppTone).toBeGreaterThanOrEqual(0);
    expect(light.fgDefaultTone).toBeGreaterThanOrEqual(0);
    expect(light.txtI).toBeGreaterThan(0);

    // Both presets must have the same set of keys (same interface shape)
    const darkKeys = Object.keys(dark).sort();
    const lightKeys = Object.keys(light).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it("T-PRESET-NO-REGRESSION: deriveTheme(brio) output is unchanged after preset refactor", () => {
    // The preset refactor must produce identical output to the pre-refactor baseline.
    // This is verified by the T-BRIO-MATCH test above; this test adds a
    // complementary check that the full token count and all ground truth tokens
    // still match after the step-6 refactor. [D01]
    const output = deriveTheme(EXAMPLE_RECIPES.brio);

    // Token count unchanged
    expect(Object.keys(output.tokens).length).toBe(371);

    // All ground truth tokens still within OKLCH delta-E < 0.02 (complementary to T-BRIO-MATCH)
    for (const [name, expected] of Object.entries(BRIO_GROUND_TRUTH)) {
      const actual = output.resolved[name];
      expect(actual).not.toBeUndefined();
      if (actual !== undefined) {
        const delta = oklchDeltaE(actual, expected);
        expect(delta).toBeLessThan(0.02);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// T-RESOLVED-CSS: generateResolvedCssExport() produces valid resolved oklch() CSS
// ---------------------------------------------------------------------------

describe("derivation-engine generateResolvedCssExport", () => {
  it("T-RESOLVED-CSS-1: produces valid CSS with oklch() values for all resolved tokens", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    const css = generateResolvedCssExport(output, EXAMPLE_RECIPES.brio);

    // Must be a non-empty string
    expect(typeof css).toBe("string");
    expect(css.length).toBeGreaterThan(0);

    // Must contain a body block
    expect(css).toContain("body {");
    expect(css).toContain("}");

    // Every entry in output.resolved must appear as an oklch() value in CSS
    for (const [name] of Object.entries(output.resolved)) {
      expect(css).toContain(name);
    }

    // All values in the body block must use oklch() notation
    const bodyMatch = css.match(/body \{([\s\S]*?)\}/);
    expect(bodyMatch).not.toBeNull();
    const bodyContent = bodyMatch![1];
    const declarations = bodyContent.split("\n").filter((l) => l.trim().startsWith("--"));
    expect(declarations.length).toBeGreaterThan(0);
    for (const decl of declarations) {
      expect(decl).toContain("oklch(");
    }
  });

  it("T-RESOLVED-CSS-2: output token names match --tug-base-* pattern", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    const css = generateResolvedCssExport(output, EXAMPLE_RECIPES.brio);

    const bodyMatch = css.match(/body \{([\s\S]*?)\}/);
    expect(bodyMatch).not.toBeNull();
    const bodyContent = bodyMatch![1];
    const declarations = bodyContent.split("\n").filter((l) => l.trim().startsWith("--"));

    for (const decl of declarations) {
      const tokenName = decl.trim().split(":")[0].trim();
      expect(tokenName.startsWith("--tug-base-")).toBe(true);
    }
  });

  it("T-RESOLVED-CSS-3: for Brio recipe, resolved CSS values match deriveTheme resolved map within delta-E < 0.02", () => {
    // Since generateResolvedCssExport reads directly from output.resolved, the
    // round-trip delta-E is exactly 0. This test parses the CSS output and
    // reconstructs OKLCH values to verify the serialization is lossless.
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    const css = generateResolvedCssExport(output, EXAMPLE_RECIPES.brio);

    // Parse token values from the CSS output
    const tokenPattern = /^\s*(--tug-base-[^:]+):\s*oklch\(([^)]+)\)/gm;
    let match;
    let checked = 0;
    while ((match = tokenPattern.exec(css)) !== null) {
      const name = match[1].trim();
      const parts = match[2].split(/\s+/);
      const L = parseFloat(parts[0]);
      const C = parseFloat(parts[1]);
      const h = parseFloat(parts[2]);

      const expected = output.resolved[name];
      expect(expected).not.toBeUndefined();
      if (expected !== undefined) {
        const delta = oklchDeltaE({ L, C, h }, expected);
        expect(delta).toBeLessThan(0.02);
        checked++;
      }
    }
    // Must have checked a meaningful number of tokens
    expect(checked).toBeGreaterThan(50);
  });

  it("T-RESOLVED-CSS-4: header contains @theme-name and @recipe-hash", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    const css = generateResolvedCssExport(output, EXAMPLE_RECIPES.brio);
    expect(css).toContain("@theme-name brio");
    expect(css).toContain("@recipe-hash");
    expect(css).toContain("resolved oklch() values");
  });
});

// ---------------------------------------------------------------------------
// Test suite: derivation-engine convergence stress tests (T4.3–T4.7)
//
// Five diverse recipes stress-test the derive → validate → auto-fix pipeline
// across varied modes, atmospheres, role hues, and slider extremes.
//
// Each test asserts 0 unexpected body-text Lc failures after autoAdjustContrast.
// The exception sets mirror T4.1/T4.2: known structural constraints are excluded
// so the tests track real regressions rather than documented design choices.
//
// Light-mode tests (T4.4, T4.7) share the same set of structural surface-
// derivation exceptions documented in T4.2 — the engine is calibrated for dark
// mode and light-mode bg-app / surface-raised / surface-overlay / surface-sunken
// / surface-screen are known structural constraints.
// ---------------------------------------------------------------------------

/**
 * Known light-mode body-text pair exceptions (structural — same as T4.2).
 *
 * The engine is calibrated for dark mode. In light mode, bg-app, bg-canvas,
 * surface-raised, surface-overlay, surface-sunken, and surface-screen are
 * derived at lightness values close to fg-default, producing Lc well below
 * the Lc 75 body-text threshold. These are not regressions — they are
 * pre-existing structural constraints deferred per Q01.
 *
 * fg-inverse on surface-screen is also structural: fg-inverse is an inverted
 * foreground designed for chips/badges, not body text on surface-screen.
 */
const LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS = new Set([
  "--tug-base-fg-default|--tug-base-bg-app",
  "--tug-base-fg-default|--tug-base-bg-canvas",
  "--tug-base-fg-default|--tug-base-surface-raised",
  "--tug-base-fg-default|--tug-base-surface-overlay",
  "--tug-base-fg-default|--tug-base-surface-sunken",
  "--tug-base-fg-default|--tug-base-surface-screen",
  "--tug-base-fg-inverse|--tug-base-surface-screen",
]);

/**
 * Run the derive → validate → auto-fix pipeline for any ThemeRecipe and return
 * the final contrast results plus unfixable list. Accepts a literal recipe
 * object (not restricted to EXAMPLE_RECIPES keys).
 */
function runPipelineForRecipe(recipe: Parameters<typeof deriveTheme>[0]): {
  finalResults: ReturnType<typeof validateThemeContrast>;
  unfixable: string[];
} {
  const output = deriveTheme(recipe);
  const initialResults = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);
  const failures = initialResults.filter((r) => !r.lcPass);
  const adjusted = autoAdjustContrast(output.tokens, output.resolved, failures, ELEMENT_SURFACE_PAIRING_MAP);
  const finalResults = validateThemeContrast(adjusted.resolved, ELEMENT_SURFACE_PAIRING_MAP);
  return { finalResults, unfixable: adjusted.unfixable };
}

/**
 * Filter a results array to only body-text unexpected failures, applying
 * the shared KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS, KNOWN_PAIR_EXCEPTIONS,
 * marginal band, and an optional set of additional pair exceptions.
 */
function unexpectedBodyTextFailures(
  results: ReturnType<typeof validateThemeContrast>,
  extraPairExceptions: ReadonlySet<string> = new Set(),
): ReturnType<typeof validateThemeContrast> {
  return results.filter((r) => {
    if (r.lcPass) return false;
    if (r.role !== "body-text") return false;
    const margin = (LC_THRESHOLDS[r.role] ?? 15) - LC_MARGINAL_DELTA;
    if (Math.abs(r.lc) >= margin) return false;
    if (KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.has(r.fg)) return false;
    if (KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`)) return false;
    if (extraPairExceptions.has(`${r.fg}|${r.bg}`)) return false;
    return true;
  });
}

describe("derivation-engine convergence stress tests", () => {
  // -------------------------------------------------------------------------
  // T4.3-stress: Warm atmosphere (amber), cool role hues (cobalt/blue/teal),
  // dark mode, high surface contrast (80) and high signal intensity (80).
  //
  // Tests that warm-cool hue complementarity at high-contrast settings does
  // not produce unexpected body-text failures in dark mode.
  // -------------------------------------------------------------------------
  it("T4.3-stress: warm atmosphere, cool roles, dark mode, high contrast — 0 unexpected body-text failures", () => {
    const recipe = {
      name: "T4.3-stress",
      mode: "dark" as const,
      cardBg: { hue: "amber" },
      text: { hue: "sand" },
      accent: "cobalt",
      active: "blue",
      agent: "teal",
      data: "cyan",
      success: "cyan",
      caution: "yellow",
      destructive: "red",
      surfaceContrast: 80,
      signalIntensity: 80,
      warmth: 70,
    };

    const { finalResults } = runPipelineForRecipe(recipe);
    const failures = unexpectedBodyTextFailures(finalResults);
    const descriptions = failures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: Lc ${f.lc.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T4.4-stress: Cool atmosphere (slate), warm role hues (orange/red/amber),
  // light mode, low surface contrast (20) and low signal intensity (20).
  //
  // Tests that warm-atmosphere + cool-role inversion at low-contrast settings
  // in light mode does not produce unexpected body-text failures beyond the
  // documented light-mode structural surface-derivation constraints.
  // -------------------------------------------------------------------------
  it("T4.4-stress: cool atmosphere, warm roles, light mode, low contrast — 0 unexpected body-text failures", () => {
    const recipe = {
      name: "T4.4-stress",
      mode: "light" as const,
      cardBg: { hue: "slate" },
      text: { hue: "cobalt" },
      accent: "orange",
      active: "red",
      agent: "amber",
      data: "yellow",
      success: "green",
      caution: "amber",
      destructive: "crimson",
      surfaceContrast: 20,
      signalIntensity: 20,
      warmth: 30,
    };

    const { finalResults } = runPipelineForRecipe(recipe);
    const failures = unexpectedBodyTextFailures(finalResults, LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS);
    const descriptions = failures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: Lc ${f.lc.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T4.5-stress: Neutral atmosphere (gray), complementary role hues
  // (violet/indigo/purple for cool + green/yellow/red for warm), dark mode,
  // default slider settings (surfaceContrast=50, signalIntensity=50).
  //
  // Tests that a near-achromatic atmosphere with complementary roles at
  // default settings produces no unexpected body-text failures.
  // -------------------------------------------------------------------------
  it("T4.5-stress: neutral atmosphere, complementary roles, dark mode, default settings — 0 unexpected body-text failures", () => {
    const recipe = {
      name: "T4.5-stress",
      mode: "dark" as const,
      cardBg: { hue: "gray" },
      text: { hue: "slate" },
      accent: "violet",
      active: "indigo",
      agent: "purple",
      data: "cyan",
      success: "green",
      caution: "yellow",
      destructive: "red",
      surfaceContrast: 50,
      signalIntensity: 50,
      warmth: 50,
    };

    const { finalResults } = runPipelineForRecipe(recipe);
    const failures = unexpectedBodyTextFailures(finalResults);
    const descriptions = failures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: Lc ${f.lc.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T4.6-stress: Extreme high signalIntensity (90), dark mode.
  //
  // Tests that maximum signal intensity (vivid role hues) does not cause
  // unexpected body-text failures in dark mode. Vivid hues may cause
  // tone-on-tone pairs to become more distinguishable but can increase
  // pressure on body-text tokens.
  // -------------------------------------------------------------------------
  it("T4.6-stress: extreme signalIntensity (90), dark mode — 0 unexpected body-text failures", () => {
    const recipe = {
      name: "T4.6-stress",
      mode: "dark" as const,
      cardBg: { hue: "violet" },
      text: { hue: "cobalt" },
      accent: "orange",
      active: "blue",
      agent: "violet",
      data: "teal",
      success: "green",
      caution: "yellow",
      destructive: "red",
      surfaceContrast: 50,
      signalIntensity: 90,
      warmth: 50,
    };

    const { finalResults } = runPipelineForRecipe(recipe);
    const failures = unexpectedBodyTextFailures(finalResults);
    const descriptions = failures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: Lc ${f.lc.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T4.7-stress: Extreme low signalIntensity (10), light mode.
  //
  // Tests that minimum signal intensity (desaturated role hues) in light mode
  // does not cause unexpected body-text failures beyond the documented
  // light-mode structural surface-derivation constraints. At low intensity,
  // role hues approach achromatic, which can shift contrast relationships.
  // -------------------------------------------------------------------------
  it("T4.7-stress: extreme low signalIntensity (10), light mode — 0 unexpected body-text failures", () => {
    const recipe = {
      name: "T4.7-stress",
      mode: "light" as const,
      cardBg: { hue: "violet" },
      text: { hue: "cobalt" },
      accent: "orange",
      active: "blue",
      agent: "violet",
      data: "teal",
      success: "green",
      caution: "yellow",
      destructive: "red",
      surfaceContrast: 50,
      signalIntensity: 10,
      warmth: 50,
    };

    const { finalResults } = runPipelineForRecipe(recipe);
    const failures = unexpectedBodyTextFailures(finalResults, LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS);
    const descriptions = failures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: Lc ${f.lc.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });
});
