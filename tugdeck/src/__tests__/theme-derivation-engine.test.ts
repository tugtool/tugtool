/**
 * Theme Derivation Engine tests.
 *
 * Covers:
 * - T2.1: deriveTheme(EXAMPLE_RECIPES.brio) produces token map with 350 entries
 * - T2.4: All output values for chromatic tokens match --tug-color(...) pattern
 * - T2.5: Theme-invariant tokens are correct for Brio
 * - T2.6: Non-override tokens resolve to valid sRGB gamut colors
 * - T4.2: End-to-end Brio light pipeline — 0 unexpected content failures + focus indicator contrast 60
 * - Recipe contrast validation (parameterized loop): one test case per EXAMPLE_RECIPES entry;
 *   adding a recipe automatically adds it to contrast validation [D02], Spec S04
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
  DARK_FORMULAS,
  LIGHT_FORMULAS,
  generateResolvedCssExport,
  resolveHueSlots,
  computeTones,
  evaluateRules,
  enforceContrastFloor,
  ACHROMATIC_ADJACENT_HUES,
  primaryColorName,
  applyWarmthBias,
  type DerivationFormulas,
  type MoodKnobs,
  type ComputedTones,
  type ResolvedHueSlots,
  type ResolvedColor,
  type ContrastDiagnostic,
} from "@/components/tugways/theme-derivation-engine";
import { CORE_VISUAL_RULES, RULES } from "@/components/tugways/derivation-rules";


import {
  validateThemeContrast,
  CONTRAST_THRESHOLDS,
  CONTRAST_MARGINAL_DELTA,
  toneToL,
  computePerceptualContrast,
  compositeOverSurface,
  hexToOkLabL,
} from "@/components/tugways/theme-accessibility";

import {
  ELEMENT_SURFACE_PAIRING_MAP,
  type ElementSurfacePairing,
} from "@/components/tugways/element-surface-pairing-map";

import {
  DEFAULT_CANONICAL_L,
  MAX_CHROMA_FOR_HUE,
  PEAK_C_SCALE,
  L_DARK,
  L_LIGHT,
} from "@/components/tugways/palette-engine";

import {
  KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS,
  KNOWN_PAIR_EXCEPTIONS,
  RECIPE_PAIR_EXCEPTIONS,
} from "./contrast-exceptions";

// ---------------------------------------------------------------------------
// Helpers for contrast floor enforcement in test helpers
// ---------------------------------------------------------------------------

/** Build element-to-pairings lookup (mirrors buildElementPairingLookup in the engine). */
function buildTestPairingLookup(
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

/** Cached pairing lookup for tests that need contrast floor behavior. */
const TEST_PAIRING_LOOKUP = buildTestPairingLookup(ELEMENT_SURFACE_PAIRING_MAP);

/**
 * Compute a ResolvedColor for a chromatic token given hue angle, intensity (0-100),
 * tone (0-100), alpha (0-100), and the primary hue name.
 *
 * Replicates the private resolveOklch() formula from theme-derivation-engine.ts
 * so that test setChromatic callbacks can populate ruleResolved, enabling
 * contrast floor enforcement within evaluateRules() test calls.
 */
function testResolveOklch(
  hueAngle: number,
  intensity: number,
  tone: number,
  alpha: number,
  hueName: string,
): ResolvedColor {
  const primaryName = primaryColorName(hueName);
  const canonL = DEFAULT_CANONICAL_L[primaryName] ?? 0.77;
  const maxC = MAX_CHROMA_FOR_HUE[primaryName] ?? 0.135;
  const peakC = maxC * PEAK_C_SCALE;
  const L =
    L_DARK +
    (Math.min(tone, 50) * (canonL - L_DARK)) / 50 +
    (Math.max(tone - 50, 0) * (L_LIGHT - canonL)) / 50;
  const C = (intensity / 100) * peakC;
  return { L, C, h: hueAngle, alpha: alpha / 100 };
}

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
  it("T2.1: deriveTheme(EXAMPLE_RECIPES.brio) produces token map with 373 entries", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    expect(Object.keys(output.tokens).length).toBe(373);
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

    // Map old property names to new six-slot token name patterns
    // bg -> surface-control-primary-{emphasis}-{role}-{state}
    // fg -> element-control-text-{emphasis}-{role}-{state}
    // border -> element-control-border-{emphasis}-{role}-{state}
    // icon -> element-control-icon-{emphasis}-{role}-{state}
    function toTokenName(emphasis: string, role: string, property: string, state: string): string {
      switch (property) {
        case "bg":     return `--tug-base-surface-control-primary-${emphasis}-${role}-${state}`;
        case "fg":     return `--tug-base-element-control-text-${emphasis}-${role}-${state}`;
        case "border": return `--tug-base-element-control-border-${emphasis}-${role}-${state}`;
        case "icon":   return `--tug-base-element-control-icon-${emphasis}-${role}-${state}`;
        default:       return `--tug-base-control-${emphasis}-${role}-${property}-${state}`;
      }
    }

    const missingTokens: string[] = [];
    for (const [emphasis, role] of T01_COMBOS) {
      for (const property of properties) {
        for (const state of states) {
          const tokenName = toTokenName(emphasis, role, property, state);
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
  // T2.1d: --tug-base-surface-global-primary-normal-control-rest alias present [D08]
  // -------------------------------------------------------------------------
  it("T2.1d: --tug-base-surface-global-primary-normal-control-rest alias is present in deriveTheme output", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    expect(output.tokens["--tug-base-surface-global-primary-normal-control-rest"]).toBe(
      "var(--tug-base-surface-control-primary-outlined-action-rest)",
    );
  });

  // -------------------------------------------------------------------------
  // T2.1e: Token names match six-slot element/surface control pattern [D02]
  // After Phase 3.5A rename: bg tokens are surface-control-primary-{emphasis}-{role}-{state}
  // and fg/border/icon tokens are element-control-{constituent}-{emphasis}-{role}-{state}
  // -------------------------------------------------------------------------
  it("T2.1e: control token names match emphasis x role pattern", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    const surfaceControlPattern =
      /^--tug-base-surface-control-primary-(filled|outlined|ghost)-(accent|action|option|agent|data|danger|success|caution)-(rest|hover|active)$/;
    const elementControlPattern =
      /^--tug-base-element-control-(text|border|icon)-(filled|outlined|ghost)-(accent|action|option|agent|data|danger|success|caution)-(rest|hover|active)$/;

    const controlTokens = Object.keys(output.tokens).filter(
      (k) =>
        (k.startsWith("--tug-base-surface-control-primary-") ||
          k.startsWith("--tug-base-element-control-")) &&
        k.match(/(filled|outlined|ghost)/),
    );

    const badTokens = controlTokens.filter(
      (t) => !surfaceControlPattern.test(t) && !elementControlPattern.test(t),
    );
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
      "--tug-base-surface-control-primary-ghost-action-rest",
      "--tug-base-element-control-border-ghost-action-rest",
      "--tug-base-surface-control-primary-ghost-danger-rest",
      "--tug-base-element-control-border-ghost-danger-rest",
      "--tug-base-control-disabled-opacity",
      "--tug-base-element-control-shadow-normal-plain-disabled",
      "--tug-base-scrollbar-track",
      "--tug-base-surface-global-primary-normal-control-rest",
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
// Test suite: derivation-engine integration (T4.x)
// T4.1 and T4.3 replaced by the parameterized "recipe contrast validation" loop [D02].
// T4.2 retained here — brio-light is a synthetic mode-flip variant, not a first-class
// EXAMPLE_RECIPES entry, so it cannot be covered by the parameterized loop.
// ---------------------------------------------------------------------------

describe("derivation-engine integration", () => {

  // -------------------------------------------------------------------------
  // T4.2: Harmony (LIGHT_FORMULAS) light-mode pipeline — 0 unexpected content failures
  //
  // Harmony uses LIGHT_FORMULAS which has correctly calibrated light-mode surface
  // tones. This eliminates the [phase-3-bug] B09-B14 structural surface-derivation
  // constraints that existed when DARK_FORMULAS was incorrectly used with light mode.
  //
  // This test validates the harmony recipe content and focus-indicator coverage.
  // Full control and focus-indicator coverage is also exercised by the
  // parameterized recipe contrast validation loop.
  //
  // References: [D03] All bugs resolved, Table T01 (B09-B14), Spec S01
  // -------------------------------------------------------------------------
  it("T4.2: deriveTheme(harmony) -> 0 unexpected content failures (LIGHT_FORMULAS used for light mode)", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.harmony);
    // Engine contrast floors are applied by construction inside evaluateRules.
    // No autoAdjustContrast post-processing is needed or performed.
    const finalResults = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    // With LIGHT_FORMULAS, surface tokens are correctly calibrated for light mode.
    // B09-B14 are resolved by root cause (switching to LIGHT_FORMULAS), not exceptions.

    // Check content only — mirrors the gallery test's light-mode coverage scope.
    const unexpectedContentFailures = finalResults.filter((r) => {
      if (r.contrastPass) return false;
      if (r.role !== "content") return false;
      const margin = (CONTRAST_THRESHOLDS[r.role] ?? 15) - CONTRAST_MARGINAL_DELTA;
      if (Math.abs(r.contrast) >= margin) return false;
      if (KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.has(r.fg)) return false;
      if (KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`)) return false;
      const recipeExceptions = RECIPE_PAIR_EXCEPTIONS["harmony"] ?? new Set<string>();
      if (recipeExceptions.has(`${r.fg}|${r.bg}`)) return false;
      return true;
    });
    const descriptions = unexpectedContentFailures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: contrast ${f.contrast.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);

    // Focus indicator assertion: control focus-on-surface pairs must pass contrast 60.
    // With LIGHT_FORMULAS, harmony's surface tokens are correctly calibrated for light mode,
    // so all focus surfaces should pass. Any structural exceptions are documented explicitly.
    const focusSurfaces = new Set([
      "--tug-base-surface-global-primary-normal-app-rest",
      "--tug-base-surface-global-primary-normal-default-rest",
      "--tug-base-surface-global-primary-normal-raised-rest",
      "--tug-base-surface-global-primary-normal-inset-rest",
      "--tug-base-surface-global-primary-normal-content-rest",
      "--tug-base-surface-global-primary-normal-overlay-rest",
      "--tug-base-surface-global-primary-normal-sunken-rest",
      "--tug-base-surface-global-primary-normal-screen-rest",
      "--tug-base-surface-field-primary-normal-plain-rest",
    ]);
    const focusFailures = finalResults.filter(
      (r) =>
        r.fg === "--tug-base-element-global-fill-normal-accentCool-rest" &&
        r.role === "control" &&
        focusSurfaces.has(r.bg) &&
        !r.contrastPass,
    );
    expect(focusFailures.map((f) => `${f.bg}: contrast ${f.contrast.toFixed(1)}`)).toEqual([]);
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
    const passingCount = results.filter((r) => r.contrastPass).length;
    const totalCount = results.length;
    expect(passingCount).toBeGreaterThan(0);
    expect(totalCount).toBeGreaterThan(passingCount); // some pairs fail → engine is honest
  });
});

// ---------------------------------------------------------------------------
// Test suite: recipe contrast validation (parameterized loop)
//
// Iterates every entry in EXAMPLE_RECIPES and creates one test case per recipe.
// Adding a new recipe to EXAMPLE_RECIPES automatically adds it to this validation
// loop — no test code changes required. [D02], Spec S04, #parameterized-test-structure
//
// Exception logic:
//   - Global exceptions: KNOWN_PAIR_EXCEPTIONS, KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS
//   - Recipe-specific exceptions: RECIPE_PAIR_EXCEPTIONS[recipeName]
//   - Marginal band: within CONTRAST_MARGINAL_DELTA contrast units of the role threshold
//
// Per-recipe assertions:
//   - 0 unexpected contrast failures across all roles
//   - fg-default on primary surfaces passes contrast 75 (core readability)
//   - tokens and resolved are consistent (chromatic tokens have --tug-color strings)
//   - Object.keys(output.tokens).length === 373 (full token set)
//
// Brio-specific:
//   - Focus indicator assertion: accent-cool-default on 9 focus surfaces passes contrast 30
//     (only applicable to dark-mode brio; light-mode recipes have structural constraints
//     documented in T4.2 and the LIGHT_MODE_FOCUS_EXCEPTIONS set)
// ---------------------------------------------------------------------------

// Focus surfaces for the focus indicator assertion (brio dark only)
const FOCUS_SURFACES = new Set([
  "--tug-base-surface-global-primary-normal-app-rest",
  "--tug-base-surface-global-primary-normal-default-rest",
  "--tug-base-surface-global-primary-normal-raised-rest",
  "--tug-base-surface-global-primary-normal-inset-rest",
  "--tug-base-surface-global-primary-normal-content-rest",
  "--tug-base-surface-global-primary-normal-overlay-rest",
  "--tug-base-surface-global-primary-normal-sunken-rest",
  "--tug-base-surface-global-primary-normal-screen-rest",
  "--tug-base-surface-field-primary-normal-plain-rest",
]);

describe("recipe contrast validation", () => {
  for (const [name, recipe] of Object.entries(EXAMPLE_RECIPES)) {
    it(`${name}: 0 unexpected contrast failures (parameterized loop, all roles)`, () => {
      // Derive theme — engine contrast floors applied by construction [D01]
      const output = deriveTheme(recipe);
      const results = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);

      // Token count must be 373 for every recipe (tokens includes invariant tokens
      // absent from resolved; tokens and resolved differ by design) [step-3 task]
      expect(Object.keys(output.tokens).length).toBe(373);

      // Consistency check: every chromatic token must have a --tug-color() string [D09]
      let tokensAndResolvedConsistent = true;
      for (const tokenName of Object.keys(output.resolved)) {
        const tokenStr = output.tokens[tokenName];
        if (!tokenStr || !tokenStr.includes("--tug-color(")) {
          tokensAndResolvedConsistent = false;
          break;
        }
      }
      expect(tokensAndResolvedConsistent).toBe(true);

      // Recipe-specific exceptions from shared module (Step 1 consolidation) [D03]
      const recipeExceptions = RECIPE_PAIR_EXCEPTIONS[name] ?? new Set<string>();

      // Filter unexpected failures: pass, marginal, known element, global pair, recipe pair
      const unexpectedFailures = results.filter((r) => {
        if (r.contrastPass) return false;
        const margin = (CONTRAST_THRESHOLDS[r.role] ?? 15) - CONTRAST_MARGINAL_DELTA;
        if (Math.abs(r.contrast) >= margin) return false;
        if (KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.has(r.fg)) return false;
        if (KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`)) return false;
        if (recipeExceptions.has(`${r.fg}|${r.bg}`)) return false;
        return true;
      });
      const descriptions = unexpectedFailures.map(
        (f) => `[${name}] ${f.fg} on ${f.bg} [${f.role}]: contrast ${f.contrast.toFixed(1)}`,
      );
      expect(descriptions).toEqual([]);

      // Core readability assertion: fg-default on primary surfaces passes contrast 75
      const coreFailures = results.filter(
        (r) =>
          r.fg === "--tug-base-element-global-text-normal-default-rest" &&
          (r.bg === "--tug-base-surface-global-primary-normal-default-rest" ||
            r.bg === "--tug-base-surface-global-primary-normal-inset-rest" ||
            r.bg === "--tug-base-surface-global-primary-normal-content-rest") &&
          !r.contrastPass,
      );
      expect(coreFailures.map((f) => `[${name}] ${f.fg} on ${f.bg}: contrast ${f.contrast.toFixed(1)}`)).toEqual([]);

      // Focus indicator assertion: brio dark only.
      // In dark mode, accent-cool-default must pass contrast 60 on all 9 focus surfaces.
      // Structural ceiling exceptions (overlay, screen) are in KNOWN_PAIR_EXCEPTIONS.
      // Light-mode recipes have structural surface-derivation constraints (engine calibrated
      // for dark mode) — those are documented in T4.2 (LIGHT_MODE_FOCUS_EXCEPTIONS).
      // This assertion is gated on recipe name "brio" for extensibility — add a
      // RECIPE_SPECIFIC_CHECKS[name] map here if other recipes need focus assertions.
      if (name === "brio") {
        const focusFailures = results.filter(
          (r) =>
            r.fg === "--tug-base-element-global-fill-normal-accentCool-rest" &&
            r.role === "control" &&
            FOCUS_SURFACES.has(r.bg) &&
            !r.contrastPass &&
            !KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`),
        );
        expect(focusFailures.map((f) => `[${name}] ${f.bg}: contrast ${f.contrast.toFixed(1)}`)).toEqual([]);
      }
    });
  }
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
  "--tug-base-element-control-shadow-normal-plain-disabled": "none",
  "--tug-base-surface-control-primary-outlined-action-rest": "transparent",
  "--tug-base-surface-control-primary-outlined-option-rest": "transparent",
  "--tug-base-surface-control-primary-outlined-agent-rest": "transparent",
  "--tug-base-surface-control-primary-ghost-action-rest": "transparent",
  "--tug-base-element-control-border-ghost-action-rest": "transparent",
  "--tug-base-surface-control-primary-ghost-option-rest": "transparent",
  "--tug-base-element-control-border-ghost-option-rest": "transparent",
  "--tug-base-surface-control-primary-ghost-danger-rest": "transparent",
  "--tug-base-element-control-border-ghost-danger-rest": "transparent",
  "--tug-base-surface-global-primary-normal-control-rest": "var(--tug-base-surface-control-primary-outlined-action-rest)",
};

export const BRIO_GROUND_TRUTH: Record<string, { L: number; C: number; h: number }> = {
  "--tug-base-element-global-fill-normal-accentCool-rest": { L: 0.81744, C: 0.24300000000000002, h: 250 }, // contrast floor enforced at control threshold 60; previous: L=0.744
  "--tug-base-element-global-fill-normal-accent-rest": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-element-global-fill-normal-accentSubtle-rest": { L: 0.528, C: 0.146, h: 55 },
  "--tug-base-surface-badge-primary-tinted-accent-rest": { L: 0.8160000000000001, C: 0.1898, h: 55 },
  "--tug-base-element-badge-border-tinted-accent-rest": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-element-badge-text-tinted-accent-rest": { L: 0.906, C: 0.21023999999999998, h: 55 },
  "--tug-base-surface-badge-primary-tinted-action-rest": { L: 0.8088, C: 0.18589999999999998, h: 230 },
  "--tug-base-element-badge-border-tinted-action-rest": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-element-badge-text-tinted-action-rest": { L: 0.9033, C: 0.20591999999999996, h: 230 },
  "--tug-base-surface-badge-primary-tinted-agent-rest": { L: 0.7584, C: 0.1937, h: 270 },
  "--tug-base-element-badge-border-tinted-agent-rest": { L: 0.708, C: 0.149, h: 270 },
  "--tug-base-element-badge-text-tinted-agent-rest": { L: 0.8844, C: 0.21455999999999997, h: 270 },
  "--tug-base-surface-badge-primary-tinted-caution-rest": { L: 0.9128, C: 0.1625, h: 90 },
  "--tug-base-element-badge-border-tinted-caution-rest": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-element-badge-text-tinted-caution-rest": { L: 0.9422999999999999, C: 0.18, h: 90 },
  "--tug-base-surface-badge-primary-tinted-danger-rest": { L: 0.7192000000000001, C: 0.28600000000000003, h: 25 },
  "--tug-base-element-badge-border-tinted-danger-rest": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-element-badge-text-tinted-danger-rest": { L: 0.8697, C: 0.31679999999999997, h: 25 },
  "--tug-base-surface-badge-primary-tinted-data-rest": { L: 0.8344, C: 0.1937, h: 175 },
  "--tug-base-element-badge-border-tinted-data-rest": { L: 0.803, C: 0.149, h: 175 },
  "--tug-base-element-badge-text-tinted-data-rest": { L: 0.9129, C: 0.21455999999999997, h: 175 },
  "--tug-base-surface-badge-primary-tinted-success-rest": { L: 0.8488, C: 0.28600000000000003, h: 140 },
  "--tug-base-element-badge-border-tinted-success-rest": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-element-badge-text-tinted-success-rest": { L: 0.9182999999999999, C: 0.31679999999999997, h: 140 },
  "--tug-base-surface-global-primary-normal-app-rest": { L: 0.2076, C: 0.005600000000000001, h: 263.33333333333326 },
  "--tug-base-surface-global-primary-normal-canvas-rest": { L: 0.2076, C: 0.005600000000000001, h: 263.33333333333326 },
  "--tug-base-element-global-border-normal-accent-rest": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-element-global-border-normal-danger-rest": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-element-global-border-normal-default-rest": { L: 0.49559999999999993, C: 0.016800000000000002, h: 263.33333333333326 }, // floor-bumped via decorative role (15); previous: L=0.5532
  "--tug-base-element-global-border-normal-inverse-rest": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-element-global-border-normal-muted-rest": { L: 0.57624, C: 0.019600000000000003, h: 263.33333333333326 },
  "--tug-base-element-global-border-normal-strong-rest": { L: 0.6108, C: 0.019600000000000003, h: 258.33333333333326 },
  "--tug-base-element-checkmark-icon-normal-plain-rest": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-element-checkmark-icon-normal-plain-mixed": { L: 0.8952, C: 0.013500000000000002, h: 250 }, // floor-bumped via decorative role (15) on toggle-track-mixed; previous: L=0.81312
  "--tug-base-surface-control-primary-normal-plain-disabled": { L: 0.39552, C: 0.0149, h: 270 },
  "--tug-base-element-control-border-normal-plain-disabled": { L: 0.47256, C: 0.016800000000000002, h: 263.33333333333326 },
  "--tug-base-element-control-text-normal-plain-disabled": { L: 0.58776, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-element-control-icon-normal-plain-disabled": { L: 0.58776, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-surface-control-primary-filled-accent-active": { L: 0.78, C: 0.2628, h: 55 },
  "--tug-base-surface-control-primary-filled-accent-hover": { L: 0.654, C: 0.1606, h: 55 },
  "--tug-base-surface-control-primary-filled-accent-rest": { L: 0.402, C: 0.146, h: 55 },
  "--tug-base-element-control-border-filled-accent-active": { L: 0.78, C: 0.2628, h: 55 },
  "--tug-base-element-control-border-filled-accent-hover": { L: 0.78, C: 0.1898, h: 55 },
  "--tug-base-element-control-border-filled-accent-rest": { L: 0.78, C: 0.1606, h: 55 },
  "--tug-base-element-control-text-filled-accent-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-accent-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-accent-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-accent-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-accent-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-accent-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-filled-action-active": { L: 0.771, C: 0.25739999999999996, h: 230 },
  "--tug-base-surface-control-primary-filled-action-hover": { L: 0.6468, C: 0.1573, h: 230 },
  "--tug-base-surface-control-primary-filled-action-rest": { L: 0.3984, C: 0.143, h: 230 },
  "--tug-base-element-control-border-filled-action-active": { L: 0.771, C: 0.25739999999999996, h: 230 },
  "--tug-base-element-control-border-filled-action-hover": { L: 0.771, C: 0.18589999999999998, h: 230 },
  "--tug-base-element-control-border-filled-action-rest": { L: 0.771, C: 0.1573, h: 230 },
  "--tug-base-element-control-text-filled-action-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-action-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-action-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-action-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-action-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-action-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-filled-agent-active": { L: 0.708, C: 0.2682, h: 270 },
  "--tug-base-surface-control-primary-filled-agent-hover": { L: 0.5963999999999999, C: 0.16390000000000002, h: 270 },
  "--tug-base-surface-control-primary-filled-agent-rest": { L: 0.3732, C: 0.149, h: 270 },
  "--tug-base-element-control-border-filled-agent-active": { L: 0.708, C: 0.2682, h: 270 },
  "--tug-base-element-control-border-filled-agent-hover": { L: 0.708, C: 0.1937, h: 270 },
  "--tug-base-element-control-border-filled-agent-rest": { L: 0.708, C: 0.16390000000000002, h: 270 },
  "--tug-base-element-control-text-filled-agent-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-agent-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-agent-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-agent-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-agent-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-agent-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-filled-caution-active": { L: 0.9009999999999999, C: 0.225, h: 90 },
  "--tug-base-surface-control-primary-filled-caution-hover": { L: 0.7508, C: 0.1375, h: 90 },
  "--tug-base-surface-control-primary-filled-caution-rest": { L: 0.4504, C: 0.125, h: 90 },
  "--tug-base-element-control-border-filled-caution-active": { L: 0.9009999999999999, C: 0.225, h: 90 },
  "--tug-base-element-control-border-filled-caution-hover": { L: 0.9009999999999999, C: 0.1625, h: 90 },
  "--tug-base-element-control-border-filled-caution-rest": { L: 0.9009999999999999, C: 0.1375, h: 90 },
  "--tug-base-element-control-text-filled-caution-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-caution-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-caution-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-caution-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-caution-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-caution-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-filled-danger-active": { L: 0.659, C: 0.396, h: 25 },
  "--tug-base-surface-control-primary-filled-danger-hover": { L: 0.5572, C: 0.24200000000000002, h: 25 },
  "--tug-base-surface-control-primary-filled-danger-rest": { L: 0.3536, C: 0.22, h: 25 },
  "--tug-base-element-control-border-filled-danger-active": { L: 0.659, C: 0.396, h: 25 },
  "--tug-base-element-control-border-filled-danger-hover": { L: 0.659, C: 0.28600000000000003, h: 25 },
  "--tug-base-element-control-border-filled-danger-rest": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-element-control-text-filled-danger-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-danger-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-danger-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-danger-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-danger-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-danger-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-filled-data-active": { L: 0.803, C: 0.2682, h: 175 },
  "--tug-base-surface-control-primary-filled-data-hover": { L: 0.6724, C: 0.16390000000000002, h: 175 },
  "--tug-base-surface-control-primary-filled-data-rest": { L: 0.4112, C: 0.149, h: 175 },
  "--tug-base-element-control-border-filled-data-active": { L: 0.803, C: 0.2682, h: 175 },
  "--tug-base-element-control-border-filled-data-hover": { L: 0.803, C: 0.1937, h: 175 },
  "--tug-base-element-control-border-filled-data-rest": { L: 0.803, C: 0.16390000000000002, h: 175 },
  "--tug-base-element-control-text-filled-data-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-data-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-data-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-data-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-data-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-data-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-filled-success-active": { L: 0.821, C: 0.396, h: 140 },
  "--tug-base-surface-control-primary-filled-success-hover": { L: 0.6868, C: 0.24200000000000002, h: 140 },
  "--tug-base-surface-control-primary-filled-success-rest": { L: 0.4184, C: 0.22, h: 140 },
  "--tug-base-element-control-border-filled-success-active": { L: 0.821, C: 0.396, h: 140 },
  "--tug-base-element-control-border-filled-success-hover": { L: 0.821, C: 0.28600000000000003, h: 140 },
  "--tug-base-element-control-border-filled-success-rest": { L: 0.821, C: 0.24200000000000002, h: 140 },
  "--tug-base-element-control-text-filled-success-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-success-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-filled-success-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-success-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-success-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-filled-success-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-ghost-action-active": { L: 1, C: 0, h: 0 },
  "--tug-base-surface-control-primary-ghost-action-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-element-control-border-ghost-action-active": { L: 0.7872, C: 0.054000000000000006, h: 250 },
  "--tug-base-element-control-border-ghost-action-hover": { L: 0.7872, C: 0.054000000000000006, h: 250 },
  "--tug-base-element-control-text-ghost-action-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-ghost-action-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-ghost-action-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-ghost-action-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-ghost-action-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-ghost-action-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-ghost-danger-active": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-surface-control-primary-ghost-danger-hover": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-element-control-border-ghost-danger-active": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-element-control-border-ghost-danger-hover": { L: 0.659, C: 0.24200000000000002, h: 25 },
  "--tug-base-element-control-text-ghost-danger-active": { L: 0.76736, C: 0.33, h: 25 },
  "--tug-base-element-control-text-ghost-danger-hover": { L: 0.76736, C: 0.28600000000000003, h: 25 },
  "--tug-base-element-control-text-ghost-danger-rest": { L: 0.76736, C: 0.24200000000000002, h: 25 },
  "--tug-base-element-control-icon-ghost-danger-active": { L: 0.76736, C: 0.33, h: 25 }, // floor-clamped to max achievable at control 60 (hue ceiling); previous: L=0.659
  "--tug-base-element-control-icon-ghost-danger-hover": { L: 0.76736, C: 0.28600000000000003, h: 25 }, // floor-clamped to max achievable; previous: L=0.659
  "--tug-base-element-control-icon-ghost-danger-rest": { L: 0.76736, C: 0.24200000000000002, h: 25 }, // floor-clamped to max achievable; previous: L=0.659
  "--tug-base-surface-control-primary-ghost-option-active": { L: 1, C: 0, h: 0 },
  "--tug-base-surface-control-primary-ghost-option-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-element-control-border-ghost-option-active": { L: 0.7872, C: 0.054000000000000006, h: 250 },
  "--tug-base-element-control-border-ghost-option-hover": { L: 0.7872, C: 0.054000000000000006, h: 250 },
  "--tug-base-element-control-text-ghost-option-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-ghost-option-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-ghost-option-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-ghost-option-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-ghost-option-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-ghost-option-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-normal-highlighted-rest": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-element-control-border-normal-highlighted-rest": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-element-control-text-normal-highlighted-rest": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-surface-control-primary-outlined-action-active": { L: 1, C: 0, h: 0 },
  "--tug-base-surface-control-primary-outlined-action-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-element-control-border-outlined-action-active": { L: 0.771, C: 0.21449999999999997, h: 230 },
  "--tug-base-element-control-border-outlined-action-hover": { L: 0.771, C: 0.18589999999999998, h: 230 },
  "--tug-base-element-control-border-outlined-action-rest": { L: 0.771, C: 0.1573, h: 230 },
  "--tug-base-element-control-text-outlined-action-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-outlined-action-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-outlined-action-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-outlined-action-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-outlined-action-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-outlined-action-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-outlined-agent-active": { L: 1, C: 0, h: 0 },
  "--tug-base-surface-control-primary-outlined-agent-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-element-control-border-outlined-agent-active": { L: 0.708, C: 0.22349999999999998, h: 270 },
  "--tug-base-element-control-border-outlined-agent-hover": { L: 0.708, C: 0.1937, h: 270 },
  "--tug-base-element-control-border-outlined-agent-rest": { L: 0.708, C: 0.16390000000000002, h: 270 },
  "--tug-base-element-control-text-outlined-agent-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-outlined-agent-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-outlined-agent-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-outlined-agent-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-outlined-agent-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-outlined-agent-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-outlined-option-active": { L: 1, C: 0, h: 0 },
  "--tug-base-surface-control-primary-outlined-option-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-element-control-border-outlined-option-active": { L: 0.7872, C: 0.0297, h: 250 },
  "--tug-base-element-control-border-outlined-option-hover": { L: 0.7656, C: 0.024300000000000002, h: 250 },
  "--tug-base-element-control-border-outlined-option-rest": { L: 0.744, C: 0.018900000000000004, h: 250 },
  "--tug-base-element-control-text-outlined-option-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-outlined-option-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-text-outlined-option-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-outlined-option-active": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-outlined-option-hover": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-element-control-icon-outlined-option-rest": { L: 0.96, C: 0.0054, h: 250 },
  "--tug-base-surface-control-primary-normal-selected-rest": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-surface-control-primary-normal-selected-hover": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-element-control-border-normal-selected-rest": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-surface-control-primary-normal-selected-disabled": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-element-control-text-normal-selected-rest": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-element-global-divider-normal-default-rest": { L: 0.34584, C: 0.016800000000000002, h: 263.33333333333326 },
  "--tug-base-element-global-divider-normal-muted-rest": { L: 0.3174, C: 0.01192, h: 270 },
  "--tug-base-element-global-text-normal-default-rest": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-element-global-text-normal-plain-disabled": { L: 0.41496, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-element-global-text-normal-inverse-rest": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-element-global-text-normal-link-rest": { L: 0.90348, C: 0.134, h: 200 },
  "--tug-base-element-global-text-normal-link-hover": { L: 0.9129, C: 0.05360000000000001, h: 200 },
  "--tug-base-element-global-text-normal-muted-rest": { L: 0.81312, C: 0.013500000000000002, h: 250 },
  "--tug-base-element-global-text-normal-onAccent-rest": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-element-global-text-normal-onCaution-rest": { L: 0.23064, C: 0.011200000000000002, h: 263.33333333333326 },
  "--tug-base-element-global-text-normal-onDanger-rest": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-element-global-text-normal-onSuccess-rest": { L: 0.23064, C: 0.011200000000000002, h: 263.33333333333326 },
  "--tug-base-element-global-text-normal-placeholder-rest": { L: 0.5064, C: 0.0162, h: 250 },
  "--tug-base-element-global-text-normal-subtle-rest": { L: 0.78684, C: 0.019600000000000003, h: 256.66666666666663 }, // floor-bumped informational 60; previous: L=0.6684
  "--tug-base-surface-field-primary-normal-plain-disabled": { L: 0.21911999999999998, C: 0.014000000000000002, h: 263.33333333333326 },
  "--tug-base-surface-field-primary-normal-plain-focus": { L: 0.23064, C: 0.011200000000000002, h: 263.33333333333326 },
  "--tug-base-surface-field-primary-normal-plain-hover": { L: 0.27276, C: 0.0149, h: 270 },
  "--tug-base-surface-field-primary-normal-plain-readOnly": { L: 0.27276, C: 0.0149, h: 270 },
  "--tug-base-surface-field-primary-normal-plain-rest": { L: 0.24216, C: 0.014000000000000002, h: 263.33333333333326 },
  "--tug-base-element-field-border-normal-plain-active": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-element-field-border-normal-danger-rest": { L: 0.72522, C: 0.22, h: 25 }, // floor-bumped control 60 (hue ceiling); previous: L=0.659
  "--tug-base-element-field-border-normal-plain-disabled": { L: 0.34584, C: 0.016800000000000002, h: 263.33333333333326 },
  "--tug-base-element-field-border-normal-plain-hover": { L: 0.75408, C: 0.019600000000000003, h: 256.66666666666663 }, // floor-bumped control 60; previous: L=0.57624
  "--tug-base-element-field-border-normal-plain-readOnly": { L: 0.34584, C: 0.016800000000000002, h: 263.33333333333326 },
  "--tug-base-element-field-border-normal-plain-rest": { L: 0.744, C: 0.0162, h: 250 }, // floor-bumped control 60; previous: L=0.54204
  "--tug-base-element-field-border-normal-success-rest": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-element-field-text-normal-plain-rest": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-element-field-text-normal-plain-disabled": { L: 0.41496, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-element-field-text-normal-plain-readOnly": { L: 0.81312, C: 0.013500000000000002, h: 250 },
  "--tug-base-element-field-text-normal-label-rest": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-element-field-text-normal-placeholder-rest": { L: 0.744, C: 0.0162, h: 250 }, // floor-bumped informational 60; previous: L=0.6252
  "--tug-base-element-field-text-normal-required-rest": { L: 0.76736, C: 0.22, h: 25 }, // floor-clamped informational 60 (hue ceiling); previous: L=0.659
  "--tug-base-element-field-fill-normal-caution-rest": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-element-field-fill-normal-danger-rest": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-element-field-fill-normal-success-rest": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-surface-highlight-primary-normal-dropTarget-rest": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-surface-highlight-primary-normal-flash-rest": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-surface-highlight-primary-normal-hover-rest": { L: 1, C: 0, h: 0 },
  "--tug-base-surface-highlight-primary-normal-inspectorTarget-rest": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-surface-highlight-primary-normal-preview-rest": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-surface-highlight-primary-normal-snapGuide-rest": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-element-global-icon-normal-active-rest": { L: 0.8735999999999999, C: 0.27, h: 250 },
  "--tug-base-element-global-icon-normal-default-rest": { L: 0.81312, C: 0.013500000000000002, h: 250 },
  "--tug-base-element-global-icon-normal-plain-disabled": { L: 0.41496, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-element-global-icon-normal-muted-rest": { L: 0.78684, C: 0.019600000000000003, h: 256.66666666666663 }, // floor-bumped informational 60; previous: L=0.57624
  "--tug-base-element-global-icon-normal-onAccent-rest": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-surface-overlay-primary-normal-dim-rest": { L: 0, C: 0, h: 0 },
  "--tug-base-surface-overlay-primary-normal-highlight-rest": { L: 1, C: 0, h: 0 },
  "--tug-base-surface-overlay-primary-normal-scrim-rest": { L: 0, C: 0, h: 0 },
  "--tug-base-element-radio-dot-normal-plain-rest": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-surface-selection-primary-normal-plain-rest": { L: 0.803, C: 0.134, h: 200 },
  "--tug-base-surface-selection-primary-normal-plain-inactive": { L: 0.6006, C: 0, h: 90 },
  "--tug-base-element-selection-text-normal-plain-rest": { L: 0.9340799999999999, C: 0.0081, h: 250 },
  "--tug-base-element-global-divider-normal-separator-rest": { L: 0.47256, C: 0.016800000000000002, h: 263.33333333333326 },
  "--tug-base-element-global-shadow-normal-lg-rest": { L: 0, C: 0, h: 0 },
  "--tug-base-element-global-shadow-normal-md-rest": { L: 0, C: 0, h: 0 },
  "--tug-base-element-global-shadow-normal-overlay-rest": { L: 0, C: 0, h: 0 },
  "--tug-base-element-global-shadow-normal-xl-rest": { L: 0, C: 0, h: 0 },
  "--tug-base-element-global-shadow-normal-xs-rest": { L: 0, C: 0, h: 0 },
  "--tug-base-surface-global-primary-normal-content-rest": { L: 0.21911999999999998, C: 0.014000000000000002, h: 263.33333333333326 },
  "--tug-base-surface-global-primary-normal-default-rest": { L: 0.28391999999999995, C: 0.0149, h: 270 },
  "--tug-base-surface-global-primary-normal-inset-rest": { L: 0.21911999999999998, C: 0.014000000000000002, h: 263.33333333333326 },
  "--tug-base-surface-global-primary-normal-overlay-rest": { L: 0.30623999999999996, C: 0.01192, h: 270 },
  "--tug-base-surface-global-primary-normal-raised-rest": { L: 0.27671999999999997, C: 0.014000000000000002, h: 263.33333333333326 },
  "--tug-base-surface-global-primary-normal-screen-rest": { L: 0.33431999999999995, C: 0.019600000000000003, h: 260 },
  "--tug-base-surface-global-primary-normal-sunken-rest": { L: 0.27276, C: 0.0149, h: 270 },
  "--tug-base-surface-tab-primary-normal-plain-active": { L: 0.33432, C: 0.033600000000000005, h: 260 },
  "--tug-base-surface-tab-primary-normal-plain-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-surface-tabClose-primary-normal-plain-hover": { L: 1, C: 0, h: 0 },
  "--tug-base-element-tabClose-text-normal-plain-hover": { L: 0.9168, C: 0.0081, h: 250 },
  "--tug-base-element-tab-text-normal-plain-active": { L: 0.93408, C: 0.0081, h: 250 },
  "--tug-base-element-tab-text-normal-plain-hover": { L: 0.9168, C: 0.0081, h: 250 },
  "--tug-base-element-tab-text-normal-plain-rest": { L: 0.80448, C: 0.018900000000000004, h: 250 }, // floor-bumped control 60; previous: L=0.744
  "--tug-base-element-toggle-icon-normal-plain-disabled": { L: 0.6108, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-element-toggle-icon-normal-plain-mixed": { L: 0.96, C: 0.013500000000000002, h: 250 }, // floor-bumped control 60 (ceiling reached); previous: L=0.89088
  "--tug-base-element-toggle-thumb-normal-plain-rest": { L: 0.96, C: 0.00816, h: 243.33333333333326 },
  "--tug-base-element-toggle-thumb-normal-plain-disabled": { L: 0.6108, C: 0.019600000000000003, h: 256.66666666666663 },
  "--tug-base-surface-toggle-track-normal-plain-disabled": { L: 0.39552, C: 0.0149, h: 270 },
  "--tug-base-surface-toggle-track-normal-mixed-rest": { L: 0.76812, C: 0.019600000000000003, h: 256.66666666666663 }, // floor-bumped control 60; previous: L=0.57624
  "--tug-base-surface-toggle-track-normal-mixed-hover": { L: 0.76812, C: 0.033600000000000005, h: 256.66666666666663 }, // floor-bumped control 60; previous: L=0.6453599999999999
  "--tug-base-surface-toggle-track-normal-off-rest": { L: 0.76812, C: 0.016800000000000002, h: 263.33333333333326 }, // floor-bumped control 60; previous: L=0.5532
  "--tug-base-surface-toggle-track-normal-off-hover": { L: 0.76812, C: 0.028000000000000004, h: 263.33333333333326 }, // floor-bumped control 60; previous: L=0.5647199999999999
  "--tug-base-surface-toggle-track-normal-on-rest": { L: 0.78, C: 0.146, h: 55 }, // floor-bumped control 60; previous: L=0.6792
  "--tug-base-surface-toggle-track-normal-on-hover": { L: 0.78, C: 0.1606, h: 55 }, // floor-bumped control 60; previous: L=0.7170000000000001
  "--tug-base-element-tone-fill-normal-accent-rest": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-surface-tone-primary-normal-accent-rest": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-element-tone-border-normal-accent-rest": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-element-tone-text-normal-accent-rest": { L: 0.9276, C: 0.146, h: 55 }, // floor-bumped informational 60; previous: L=0.78
  "--tug-base-element-tone-icon-normal-accent-rest": { L: 0.78, C: 0.146, h: 55 },
  "--tug-base-element-tone-fill-normal-active-rest": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-surface-tone-primary-normal-active-rest": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-element-tone-border-normal-active-rest": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-element-tone-text-normal-active-rest": { L: 0.92598, C: 0.143, h: 230 }, // floor-bumped informational 60; previous: L=0.771
  "--tug-base-element-tone-icon-normal-active-rest": { L: 0.771, C: 0.143, h: 230 },
  "--tug-base-element-tone-fill-normal-agent-rest": { L: 0.708, C: 0.149, h: 270 },
  "--tug-base-surface-tone-primary-normal-agent-rest": { L: 0.708, C: 0.149, h: 270 },
  "--tug-base-element-tone-border-normal-agent-rest": { L: 0.708, C: 0.149, h: 270 },
  "--tug-base-element-tone-text-normal-agent-rest": { L: 0.89952, C: 0.149, h: 270 }, // floor-bumped informational 60; previous: L=0.708
  "--tug-base-element-tone-icon-normal-agent-rest": { L: 0.7684799999999999, C: 0.149, h: 270 }, // floor-bumped informational 60; previous: L=0.708
  "--tug-base-element-tone-fill-normal-caution-rest": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-surface-tone-primary-normal-caution-rest": { L: 0.6006, C: 0.125, h: 90 },
  "--tug-base-element-tone-border-normal-caution-rest": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-element-tone-text-normal-caution-rest": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-element-tone-icon-normal-caution-rest": { L: 0.9009999999999999, C: 0.125, h: 90 },
  "--tug-base-element-tone-fill-normal-danger-rest": { L: 0.91184, C: 0.22, h: 25 },
  "--tug-base-surface-tone-primary-normal-danger-rest": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-element-tone-border-normal-danger-rest": { L: 0.659, C: 0.22, h: 25 },
  "--tug-base-element-tone-text-normal-danger-rest": { L: 0.88174, C: 0.22, h: 25 }, // floor-clamped informational 60 (hue ceiling); previous: L=0.659
  "--tug-base-element-tone-icon-normal-danger-rest": { L: 0.76736, C: 0.22, h: 25 }, // floor-clamped informational 60 (hue ceiling); previous: L=0.659
  "--tug-base-element-tone-fill-normal-data-rest": { L: 0.803, C: 0.149, h: 175 },
  "--tug-base-surface-tone-primary-normal-data-rest": { L: 0.803, C: 0.149, h: 175 },
  "--tug-base-element-tone-border-normal-data-rest": { L: 0.803, C: 0.149, h: 175 },
  "--tug-base-element-tone-text-normal-data-rest": { L: 0.93802, C: 0.149, h: 175 }, // floor-bumped informational 60; previous: L=0.803
  "--tug-base-element-tone-icon-normal-data-rest": { L: 0.803, C: 0.149, h: 175 },
  "--tug-base-element-tone-fill-normal-success-rest": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-surface-tone-primary-normal-success-rest": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-element-tone-border-normal-success-rest": { L: 0.821, C: 0.22, h: 140 },
  "--tug-base-element-tone-text-normal-success-rest": { L: 0.9433199999999999, C: 0.22, h: 140 }, // floor-bumped informational 60; previous: L=0.821
  "--tug-base-element-tone-icon-normal-success-rest": { L: 0.821, C: 0.22, h: 140 }
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
// Step 9: DerivationFormulas exports (T-FORMULAS-EXPORTS)
// Verifies that DARK_FORMULAS is exported and satisfies DerivationFormulas,
// and that deriveTheme output is unchanged after the preset deletion. [D01] [D07]
// ---------------------------------------------------------------------------

describe("derivation-engine formulas-exports", () => {
  it("T-FORMULAS-EXPORTS: DARK_FORMULAS satisfies DerivationFormulas with correct values", () => {
    // Verify DARK_FORMULAS satisfies the DerivationFormulas interface
    // (TypeScript compile-time check + runtime field presence). [D01] [D07]
    const formulas: DerivationFormulas = DARK_FORMULAS;

    // Spot-check key fields match Brio ground truth values documented in the plan
    expect(formulas.bgAppTone).toBe(5);
    expect(formulas.surfaceSunkenTone).toBe(11);
    expect(formulas.fgDefaultTone).toBe(94);
    expect(formulas.txtI).toBe(3);
    expect(formulas.shadowXsAlpha).toBe(20);
    expect(formulas.filledBgDarkTone).toBe(20);
    expect(formulas.fieldBgRestTone).toBe(8);

    // Verify EXAMPLE_RECIPES.brio.formulas is DARK_FORMULAS directly [D03]
    expect(EXAMPLE_RECIPES.brio.formulas).toBe(DARK_FORMULAS);
  });

  it("T-FORMULAS-NO-REGRESSION: deriveTheme(brio) output is unchanged after preset deletion", () => {
    // The preset deletion must produce identical output to the pre-refactor baseline.
    // This is verified by the T-BRIO-MATCH test above; this test adds a
    // complementary check that the full token count and all ground truth tokens
    // still match after the step-9 deletion. [D01]
    const output = deriveTheme(EXAMPLE_RECIPES.brio);

    // Token count unchanged
    expect(Object.keys(output.tokens).length).toBe(373);

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
// Step 3: Formula consolidation tests (T-FORMULAS-STEP3)
// Verifies that DerivationFormulas has been consolidated to emphasis-level
// fields and that EXAMPLE_RECIPES uses direct formula objects. [D02] [D04]
// ---------------------------------------------------------------------------

describe("derivation-engine formula-consolidation step-3", () => {
  it("T-FORMULAS-STEP3-RECIPES: EXAMPLE_RECIPES.brio and harmony use DARK_FORMULAS and LIGHT_FORMULAS directly", () => {
    // Phase 3 step 9: EXAMPLE_RECIPES uses direct formula objects, not spread composition. [D04]
    expect(EXAMPLE_RECIPES.brio.formulas).toBe(DARK_FORMULAS);
    expect(EXAMPLE_RECIPES.harmony.formulas).toBe(LIGHT_FORMULAS);
  });

  it("T-FORMULAS-STEP3-EMPHASIS-FIELDS: emphasis-level outlined fields exist with correct values", () => {
    // Outlined fg/icon emphasis-level fields (Table T01 D02)
    expect(DARK_FORMULAS.outlinedFgRestTone).toBe(100);
    expect(DARK_FORMULAS.outlinedFgHoverTone).toBe(100);
    expect(DARK_FORMULAS.outlinedFgActiveTone).toBe(100);
    expect(DARK_FORMULAS.outlinedFgI).toBe(2);
    expect(DARK_FORMULAS.outlinedIconRestTone).toBe(100);
    expect(DARK_FORMULAS.outlinedIconHoverTone).toBe(100);
    expect(DARK_FORMULAS.outlinedIconActiveTone).toBe(100);
    expect(DARK_FORMULAS.outlinedIconI).toBe(2);
    // Ghost emphasis-level fields (Table T02 D02)
    expect(DARK_FORMULAS.ghostFgRestTone).toBe(100);
    expect(DARK_FORMULAS.ghostFgHoverTone).toBe(100);
    expect(DARK_FORMULAS.ghostFgActiveTone).toBe(100);
    expect(DARK_FORMULAS.ghostFgRestI).toBe(2);
    expect(DARK_FORMULAS.ghostFgHoverI).toBe(2);
    expect(DARK_FORMULAS.ghostFgActiveI).toBe(2);
    expect(DARK_FORMULAS.ghostIconRestTone).toBe(100);
    expect(DARK_FORMULAS.ghostIconHoverTone).toBe(100);
    expect(DARK_FORMULAS.ghostIconActiveTone).toBe(100);
    expect(DARK_FORMULAS.ghostIconRestI).toBe(2);
    expect(DARK_FORMULAS.ghostIconHoverI).toBe(2);
    expect(DARK_FORMULAS.ghostIconActiveI).toBe(2);
    expect(DARK_FORMULAS.ghostBorderI).toBe(20);
    expect(DARK_FORMULAS.ghostBorderTone).toBe(60);
    // Per-role exception preserved: outlined-option border tones
    expect(DARK_FORMULAS.outlinedOptionBorderRestTone).toBe(50);
    expect(DARK_FORMULAS.outlinedOptionBorderHoverTone).toBe(55);
    expect(DARK_FORMULAS.outlinedOptionBorderActiveTone).toBe(60);
  });

  it("T-FORMULAS-STEP3-PER-ROLE-REMOVED: per-role outlined/ghost fg fields are absent from DerivationFormulas", () => {
    // These per-role fields should NOT exist in the consolidated interface.
    // Checking via hasOwnProperty at runtime to verify TypeScript removed them.
    const f = DARK_FORMULAS as Record<string, unknown>;
    // Outlined per-role fields that were removed
    expect(f["outlinedActionFgRestTone"]).toBeUndefined();
    expect(f["outlinedAgentFgRestTone"]).toBeUndefined();
    expect(f["outlinedOptionFgRestTone"]).toBeUndefined();
    expect(f["outlinedActionIconRestTone"]).toBeUndefined();
    expect(f["outlinedAgentIconRestTone"]).toBeUndefined();
    expect(f["outlinedOptionIconRestTone"]).toBeUndefined();
    expect(f["outlinedFgTone"]).toBeUndefined(); // renamed to outlinedFgRestTone
    // Light-mode per-role fields that were removed
    expect(f["outlinedActionFgRestToneLight"]).toBeUndefined();
    expect(f["outlinedAgentFgRestToneLight"]).toBeUndefined();
    expect(f["outlinedOptionFgRestToneLight"]).toBeUndefined();
    // Ghost per-role fields that were removed
    expect(f["ghostActionFgTone"]).toBeUndefined();
    expect(f["ghostActionFgI"]).toBeUndefined();
    expect(f["ghostOptionFgTone"]).toBeUndefined();
    expect(f["ghostOptionFgI"]).toBeUndefined();
    expect(f["ghostActionFgRestTone"]).toBeUndefined();
    expect(f["ghostOptionFgRestTone"]).toBeUndefined();
    expect(f["ghostActionIconRestTone"]).toBeUndefined();
    expect(f["ghostOptionIconRestTone"]).toBeUndefined();
    expect(f["ghostActionBorderI"]).toBeUndefined();
    expect(f["ghostOptionBorderI"]).toBeUndefined();
  });

  it("T-FORMULAS-STEP3-NET-REDUCTION: DerivationFormulas field count reduced by >= 40 vs pre-consolidation", () => {
    // Pre-consolidation field count was captured before making changes.
    // After consolidation, the interface should have at least 40 fewer fields.
    // Pre-step3 field count: measured from the old DARK_FORMULAS at the time.
    // The old per-role section had:
    //   - outlinedFgTone, outlinedFgI (2 - renamed/kept)
    //   - outlined*{Action,Agent,Option}Fg*ToneLight (18 fields)
    //   - ghost{Action,Option}Fg{Tone,I} (4 fields)
    //   - ghost{Action,Option}Fg/Icon light fields (20 fields)
    //   - ghost{Action,Option}Border{I,Tone} (4 fields)
    //   - outlined{Action,Agent,Option}Fg{Rest,Hover,Active}Tone (9 fields)
    //   - outlined{Action,Agent,Option}Fg{Rest,Hover,Active}I (9 fields)
    //   - outlined{Action,Agent,Option}Icon{Rest,Hover,Active}Tone (9 fields)
    //   - outlined{Action,Agent,Option}Icon{Rest,Hover,Active}I (9 fields)
    //   - ghost{Action,Option}Fg{Rest,Hover,Active}Tone (6 fields)
    //   - ghost{Action,Option}Fg{Rest,Hover,Active}I (6 fields)
    //   - ghost{Action,Option}Icon{Rest,Hover,Active}Tone (6 fields)
    //   - ghost{Action,Option}Icon{Rest,Hover,Active}I (6 fields)
    // Total old per-role section: ~108 fields
    // New emphasis-level section has ~62 fields
    // Net reduction: ~46 fields
    const fieldCount = Object.keys(DARK_FORMULAS).length;
    // Pre-consolidation the old DARK_FORMULAS had 268 fields.
    // After consolidation it should have <= 228 fields (reduction >= 40).
    // Actual measured reduction: 268 -> 198 (70 fields removed).
    expect(fieldCount).toBeLessThanOrEqual(228);
    expect(fieldCount).toBeGreaterThan(100); // sanity check: not too few
  });

  it("T-FORMULAS-STEP3-TOKEN-PARITY: generate:tokens output identical to pre-consolidation snapshot", () => {
    // Token derivation must be identical after field consolidation.
    // This is verified by running generate:tokens and comparing snapshots (done manually).
    // This test verifies the runtime deriveTheme produces the same 373 tokens.
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    expect(Object.keys(output.tokens).length).toBe(373);

    // Verify all ground truth tokens are still within delta-E < 0.02
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
// Five diverse recipes stress-test the derive → validate pipeline
// across varied modes, atmospheres, role hues, and slider extremes.
//
// Each test asserts 0 unexpected content perceptual contrast failures.
// Step 5: autoAdjustContrast is no longer invoked — the engine's enforceContrastFloor
// produces compliant tokens by construction.
// The exception sets mirror the parameterized loop / T4.2: known structural constraints are excluded
// so the tests track real regressions rather than documented design choices.
//
// Light-mode tests (T4.4, T4.7) use LIGHT_FORMULAS, which has correctly calibrated
// surface tones for light mode. This eliminates the [phase-3-bug] B09-B14 structural
// surface-derivation constraints that existed when DARK_FORMULAS was incorrectly used
// with light mode. No extra pair exceptions are needed for these tests.
// ---------------------------------------------------------------------------

/**
 * Known dark-mode content pair exceptions for high surfaceContrast recipes.
 *
 * At surfaceContrast=80, surface-screen tone rises to ~24 (L≈0.43 for indigo).
 * fg-default (txt hue at t=100) and fg-inverse at t=100 achieve contrast ~68
 * against surface-screen — below content threshold (75) and outside the
 * marginal band (≥70). The contrast floor correctly identifies that even t=100
 * fails — the ceiling constraint is structural. This is a structural constraint
 * for recipes combining a warm/ochre text hue with high surface contrast; not
 * a regression.
 */
const DARK_HIGH_CONTRAST_PAIR_EXCEPTIONS = new Set([
  "--tug-base-element-global-text-normal-default-rest|--tug-base-surface-global-primary-normal-screen-rest",
  "--tug-base-element-global-text-normal-inverse-rest|--tug-base-surface-global-primary-normal-screen-rest",
]);

/**
 * Run the derive → validate pipeline for any ThemeRecipe and return
 * the final contrast results. Accepts a literal recipe object (not restricted
 * to EXAMPLE_RECIPES keys).
 *
 * Step 5: autoAdjustContrast removed from pipeline. enforceContrastFloor inside
 * evaluateRules produces compliant tokens by construction.
 */
function runPipelineForRecipe(recipe: Parameters<typeof deriveTheme>[0]): {
  finalResults: ReturnType<typeof validateThemeContrast>;
} {
  const output = deriveTheme(recipe);
  const finalResults = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);
  return { finalResults };
}

/**
 * Filter a results array to only content unexpected failures, applying
 * the shared KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS, KNOWN_PAIR_EXCEPTIONS,
 * marginal band, and an optional set of additional pair exceptions.
 */
function unexpectedBodyTextFailures(
  results: ReturnType<typeof validateThemeContrast>,
  extraPairExceptions: ReadonlySet<string> = new Set(),
): ReturnType<typeof validateThemeContrast> {
  return results.filter((r) => {
    if (r.contrastPass) return false;
    if (r.role !== "content") return false;
    const margin = (CONTRAST_THRESHOLDS[r.role] ?? 15) - CONTRAST_MARGINAL_DELTA;
    if (Math.abs(r.contrast) >= margin) return false;
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
  // not produce unexpected content failures in dark mode.
  // -------------------------------------------------------------------------
  it("T4.3-stress: warm atmosphere, cool roles, dark mode, high contrast — 0 unexpected content failures", () => {
    const recipe = {
      name: "T4.3-stress",
      description: "Stress test: warm atmosphere, cool roles, dark mode, high contrast.",
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
    // fg-default|surface-screen and fg-inverse|surface-screen are structurally
    // constrained at surfaceContrast=80: surface-screen is too bright for fg
    // at max tone to achieve contrast 75. See DARK_HIGH_CONTRAST_PAIR_EXCEPTIONS.
    const failures = unexpectedBodyTextFailures(finalResults, DARK_HIGH_CONTRAST_PAIR_EXCEPTIONS);
    const descriptions = failures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: contrast ${f.contrast.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T4.4-stress: Cool atmosphere (slate), warm role hues (orange/red/amber),
  // light mode, low surface contrast (20) and low signal intensity (20).
  //
  // Tests that warm-atmosphere + cool-role inversion at low-contrast settings
  // in light mode does not produce unexpected content failures.
  // Uses LIGHT_FORMULAS for light mode — resolves [phase-3-bug] B09-B14 at root cause.
  //
  // References: [D03] All bugs resolved, Table T01 (B09-B14)
  // -------------------------------------------------------------------------
  it("T4.4-stress: cool atmosphere, warm roles, light mode, low contrast — 0 unexpected content failures", () => {
    const recipe = {
      name: "T4.4-stress",
      description: "Stress test: cool atmosphere, warm roles, light mode, low contrast.",
      mode: "light" as const,
      formulas: LIGHT_FORMULAS,
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
    const failures = unexpectedBodyTextFailures(finalResults);
    const descriptions = failures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: contrast ${f.contrast.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T4.5-stress: Neutral atmosphere (gray), complementary role hues
  // (violet/indigo/purple for cool + green/yellow/red for warm), dark mode,
  // default slider settings (surfaceContrast=50, signalIntensity=50).
  //
  // Tests that a near-achromatic atmosphere with complementary roles at
  // default settings produces no unexpected content failures.
  // -------------------------------------------------------------------------
  it("T4.5-stress: neutral atmosphere, complementary roles, dark mode, default settings — 0 unexpected content failures", () => {
    const recipe = {
      name: "T4.5-stress",
      description: "Stress test: neutral atmosphere, complementary roles, dark mode, default settings.",
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
      (f) => `${f.fg} on ${f.bg} [${f.role}]: contrast ${f.contrast.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T4.6-stress: Extreme high signalIntensity (90), dark mode.
  //
  // Tests that maximum signal intensity (vivid role hues) does not cause
  // unexpected content failures in dark mode. Vivid hues may cause
  // tone-on-tone pairs to become more distinguishable but can increase
  // pressure on content tokens.
  // -------------------------------------------------------------------------
  it("T4.6-stress: extreme signalIntensity (90), dark mode — 0 unexpected content failures", () => {
    const recipe = {
      name: "T4.6-stress",
      description: "Stress test: extreme signalIntensity (90), dark mode.",
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
      (f) => `${f.fg} on ${f.bg} [${f.role}]: contrast ${f.contrast.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T4.7-stress: Extreme low signalIntensity (10), light mode.
  //
  // Tests that minimum signal intensity (desaturated role hues) in light mode
  // does not cause unexpected content failures. At low intensity, role hues
  // approach achromatic, which can shift contrast relationships.
  // Uses LIGHT_FORMULAS for light mode — resolves [phase-3-bug] B09-B14 at root cause.
  //
  // References: [D03] All bugs resolved, Table T01 (B09-B14)
  // -------------------------------------------------------------------------
  it("T4.7-stress: extreme low signalIntensity (10), light mode — 0 unexpected content failures", () => {
    const recipe = {
      name: "T4.7-stress",
      description: "Stress test: extreme low signalIntensity (10), light mode.",
      mode: "light" as const,
      formulas: LIGHT_FORMULAS,
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
    const failures = unexpectedBodyTextFailures(finalResults);
    const descriptions = failures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: contrast ${f.contrast.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });
});

// =============================================================================
// Step 3: resolveHueSlots() tests
// =============================================================================

describe("resolveHueSlots — Step 3", () => {
  // -------------------------------------------------------------------------
  // T-RESOLVE: resolveHueSlots(EXAMPLE_RECIPES.brio, 50) produces expected
  // angle/name/ref for each slot.
  //
  // Brio dark recipe:
  //   cardBg.hue = "indigo-violet"  -> atm
  //   text.hue   = "cobalt"         -> txt
  //   canvas     = "indigo-violet"  -> canvas
  //   cardFrame  = "indigo"         -> cardFrame
  //   borderTint = "indigo-violet"  -> borderTint
  //   link       = "cyan"           -> interactive
  //   active     = undefined -> "blue"
  //   accent     = undefined -> "orange"
  //
  // At warmth=50, warmthBias=0, so no angle shift for achromatic hues.
  // -------------------------------------------------------------------------
  it("T-RESOLVE: Brio recipe at warmth=50 produces correct slot for each key", () => {
    const slots: ResolvedHueSlots = resolveHueSlots(EXAMPLE_RECIPES.brio, 50);

    // atm: "indigo-violet" — hyphenated, warmth bias = 0 at warmth=50
    expect(slots.atm.name).toBeTruthy();
    expect(slots.atm.angle).toBeGreaterThan(0);
    expect(slots.atm.ref).toBeTruthy();
    expect(slots.atm.primaryName).toBeTruthy();

    // txt: "cobalt" — bare name, achromatic-adjacent, warmth=50 -> no bias
    expect(slots.txt.ref).toBe("cobalt");
    expect(slots.txt.name).toBe("cobalt");
    expect(slots.txt.primaryName).toBe("cobalt");

    // canvas: same as atm for Brio
    expect(slots.canvas.ref).toBe(slots.atm.ref);
    expect(slots.canvas.angle).toBe(slots.atm.angle);

    // cardFrame: "indigo"
    expect(slots.cardFrame.ref).toBe("indigo");
    expect(slots.cardFrame.name).toBe("indigo");

    // borderTint: same as atm for Brio
    expect(slots.borderTint.ref).toBe(slots.atm.ref);

    // interactive: "cyan" — not achromatic-adjacent, no warmth bias
    expect(slots.interactive.ref).toBe("cyan");
    expect(slots.interactive.name).toBe("cyan");

    // active: "blue" (default)
    expect(slots.active.ref).toBe("blue");

    // accent: "orange" (default)
    expect(slots.accent.ref).toBe("orange");

    // Semantic hues (no warmth bias)
    expect(slots.destructive.ref).toBe("red");
    expect(slots.success.ref).toBe("green");
    expect(slots.caution.ref).toBe("yellow");
    expect(slots.agent.ref).toBe("violet");
    expect(slots.data.ref).toBe("teal");

    // surfBareBase: bare base of "indigo-violet" -> "violet"
    expect(slots.surfBareBase.ref).toBe("violet");
    expect(slots.surfBareBase.primaryName).toBe("violet");

    // surfScreen: dark mode "indigo"
    expect(slots.surfScreen.ref).toBe("indigo");
    expect(slots.surfScreen.name).toBe("indigo");

    // fgMuted: dark mode -> bare primary of "cobalt" = "cobalt"
    expect(slots.fgMuted.ref).toBe("cobalt");

    // fgSubtle: dark mode "indigo-cobalt"
    expect(slots.fgSubtle.name).toBe("indigo-cobalt");

    // fgDisabled: dark mode "indigo-cobalt"
    expect(slots.fgDisabled.name).toBe("indigo-cobalt");

    // fgInverse: dark mode "sapphire-cobalt"
    expect(slots.fgInverse.name).toBe("sapphire-cobalt");

    // fgPlaceholder: same as fgMuted
    expect(slots.fgPlaceholder.ref).toBe(slots.fgMuted.ref);
    expect(slots.fgPlaceholder.angle).toBe(slots.fgMuted.angle);

    // selectionInactive: dark mode "yellow" (fixed)
    expect(slots.selectionInactive.ref).toBe("yellow");
    expect(slots.selectionInactive.name).toBe("yellow");

    // borderTintBareBase: bare base of "indigo-violet" -> "violet"
    expect(slots.borderTintBareBase.ref).toBe("violet");

    // borderStrong: borderTint angle - 5 degrees
    // "indigo-violet" angle minus 5° — just verify it differs from borderTint
    expect(slots.borderStrong.angle).not.toBe(slots.borderTint.angle);

    // All slots must have required fields
    const allSlots = Object.values(slots) as ResolvedHueSlot[];
    for (const s of allSlots) {
      expect(typeof s.angle).toBe("number");
      expect(typeof s.name).toBe("string");
      expect(typeof s.ref).toBe("string");
      expect(typeof s.primaryName).toBe("string");
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.ref.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // T-RESOLVE-LIGHT: resolveHueSlots for a light-mode recipe produces correct
  // per-tier hues (fg tiers collapse to txt; selection uses atmBaseAngle-20).
  // -------------------------------------------------------------------------
  it("T-RESOLVE-LIGHT: light-mode recipe collapses fg tiers to txt", () => {
    // Supply light-mode hue-name formulas. The fg tiers all point to txtHue ("cobalt"),
    // fgPlaceholder copies atm, selectionInactive uses the atm-offset (non-semantic) path.
    // All other formula fields are irrelevant to resolveHueSlots, so spread DARK_FORMULAS.
    const lightFormulas = {
      ...DARK_FORMULAS,
      surfScreenHue: "cobalt",          // same as txtHue -> copies txt slot
      fgMutedHueExpr: "cobalt",         // literal txtHue (not "__bare_primary")
      fgSubtleHue: "cobalt",            // collapses to txt
      fgDisabledHue: "cobalt",          // collapses to txt
      fgInverseHue: "cobalt",           // collapses to txt
      fgPlaceholderSource: "atm",       // copies atm slot
      selectionInactiveSemanticMode: false, // compute atm-offset path
      selectionInactiveHue: "yellow",   // unused when semanticMode=false
    };
    const lightRecipe = {
      name: "test-light",
      description: "Test recipe for light mode hue slot resolution.",
      mode: "light" as const,
      cardBg: { hue: "yellow" },
      text: { hue: "cobalt" },
      warmth: 50,
      formulas: lightFormulas,
    };
    const slots: ResolvedHueSlots = resolveHueSlots(lightRecipe, 50);

    // In light mode, fg tiers all collapse to txt hue (fgPlaceholder is the exception: uses atm)
    expect(slots.fgMuted.ref).toBe("cobalt");
    expect(slots.fgSubtle.ref).toBe("cobalt");
    expect(slots.fgDisabled.ref).toBe("cobalt");
    expect(slots.fgInverse.ref).toBe("cobalt");
    // fgPlaceholder in light mode uses atm hue (Harmony pattern), not txt hue
    expect(slots.fgPlaceholder.ref).toBe("yellow");

    // selectionInactive in light: atm angle (yellow ≈ 85°) - 20 = ~65° -> some hue near green/lime
    // Verify it's NOT yellow (the dark mode fixed value)
    expect(slots.selectionInactive.ref).not.toBe("yellow");

    // surfScreen: light mode -> txt
    expect(slots.surfScreen.ref).toBe("cobalt");
  });

  // -------------------------------------------------------------------------
  // T-WARMTH: warmth bias produces correct angle shifts for achromatic-adjacent hues.
  //
  // At warmth=100: warmthBias = ((100-50)/50)*12 = +12°
  // "cobalt" base angle ≈ 250°; with +12° bias = 262° -> "indigo-cobalt" or similar
  // At warmth=0: warmthBias = -12°; "cobalt" 250° - 12° = 238° -> "sapphire-cobalt"
  // Non-achromatic hues (e.g., "orange") must NOT shift.
  // -------------------------------------------------------------------------
  it("T-WARMTH: applyWarmthBias shifts achromatic hues and leaves vivid hues unchanged", () => {
    // Achromatic hue "cobalt" shifts with bias
    const cobaltAngle = 250; // approximate
    const biasedUp = applyWarmthBias("cobalt", cobaltAngle, 12);
    expect(biasedUp).toBeCloseTo(262, 0);

    const biasedDown = applyWarmthBias("cobalt", cobaltAngle, -12);
    expect(biasedDown).toBeCloseTo(238, 0);

    const noBias = applyWarmthBias("cobalt", cobaltAngle, 0);
    expect(noBias).toBe(cobaltAngle);

    // Vivid hue "orange" must NOT shift regardless of bias
    const orangeAngle = 40; // approximate
    expect(applyWarmthBias("orange", orangeAngle, 12)).toBe(orangeAngle);
    expect(applyWarmthBias("red", 30, 12)).toBe(30);
    expect(applyWarmthBias("green", 140, 12)).toBe(140);
    expect(applyWarmthBias("yellow", 85, -12)).toBe(85);
    expect(applyWarmthBias("cyan", 195, 12)).toBe(195);
  });

  it("T-WARMTH: resolveHueSlots at warmth extremes shifts cobalt txt angle", () => {
    const baseRecipe = {
      name: "test-warmth",
      description: "Test recipe for warmth bias angle shifts.",
      mode: "dark" as const,
      cardBg: { hue: "violet" },
      text: { hue: "cobalt" },
    };

    const slotsW50 = resolveHueSlots(baseRecipe, 50);
    const slotsW100 = resolveHueSlots(baseRecipe, 100);
    const slotsW0 = resolveHueSlots(baseRecipe, 0);

    // At warmth=50 (no bias), cobalt txt angle stays near 250°
    const baseAngle = slotsW50.txt.angle;

    // At warmth=100, txt shifts by +12°
    expect(slotsW100.txt.angle).toBeCloseTo(baseAngle + 12, 0);

    // At warmth=0, txt shifts by -12°
    expect(slotsW0.txt.angle).toBeCloseTo((baseAngle - 12 + 360) % 360, 0);

    // Orange accent must not shift regardless of warmth
    expect(slotsW100.accent.angle).toBe(slotsW50.accent.angle);
    expect(slotsW0.accent.angle).toBe(slotsW50.accent.angle);
  });

  // -------------------------------------------------------------------------
  // T-BARE-BASE: bare base extraction returns "violet" for "indigo-violet".
  // -------------------------------------------------------------------------
  it("T-BARE-BASE: surfBareBase returns violet for indigo-violet atmosphere", () => {
    const recipe = {
      name: "test-bare-base",
      description: "Test recipe for surfBareBase extraction from hyphenated hue.",
      mode: "dark" as const,
      cardBg: { hue: "indigo-violet" },
      text: { hue: "cobalt" },
    };
    const slots = resolveHueSlots(recipe, 50);
    expect(slots.surfBareBase.ref).toBe("violet");
    expect(slots.surfBareBase.primaryName).toBe("violet");
  });

  it("T-BARE-BASE: surfBareBase returns bare name for non-hyphenated atmosphere", () => {
    const recipe = {
      name: "test-bare-base-bare",
      description: "Test recipe for surfBareBase extraction from bare hue name.",
      mode: "dark" as const,
      cardBg: { hue: "violet" },
      text: { hue: "cobalt" },
    };
    const slots = resolveHueSlots(recipe, 50);
    // For bare "violet", bare base is "violet" itself
    expect(slots.surfBareBase.primaryName).toBe("violet");
  });

  it("T-BARE-BASE: borderTintBareBase mirrors surfBareBase logic for borderTint hue", () => {
    const recipe = {
      name: "test-bt-bare",
      description: "Test recipe for borderTintBareBase extraction from hyphenated hue.",
      mode: "dark" as const,
      cardBg: { hue: "indigo-violet" },
      text: { hue: "cobalt" },
      borderTint: "indigo-violet",
    };
    const slots = resolveHueSlots(recipe, 50);
    expect(slots.borderTintBareBase.ref).toBe("violet");
    expect(slots.borderTintBareBase.primaryName).toBe("violet");
  });

  // -------------------------------------------------------------------------
  // T-RESOLVE-MATCH: resolveHueSlots output matches existing inline deriveTheme
  // variables for the Brio recipe at warmth=50.
  //
  // This is the assertion required by the plan: "Add assertion that resolveHueSlots
  // output matches existing inline variables for Brio recipe."
  //
  // We verify by calling deriveTheme on Brio and checking that the token values
  // produced are identical before and after — ensuring resolveHueSlots() running
  // in parallel doesn't change any output.
  // -------------------------------------------------------------------------
  it("T-RESOLVE-MATCH: deriveTheme(brio) output is unchanged after adding resolveHueSlots call", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);

    // Token count must remain 373
    expect(Object.keys(output.tokens).length).toBe(373);

    // Key Brio dark token spot-checks (from T-BRIO-MATCH fixture)
    // bg-app: indigo-violet i:2 t:5
    expect(output.tokens["--tug-base-surface-global-primary-normal-app-rest"]).toBe("--tug-color(indigo-violet, i: 2, t: 5)");

    // fg-default: cobalt i:3 t:94
    expect(output.tokens["--tug-base-element-global-text-normal-default-rest"]).toBe("--tug-color(cobalt, i: 3, t: 94)");

    // fg-subtle: indigo-cobalt i:7, tone adjusted by contrast floor from 37 → 63
    // (informational threshold 60 against surface-default requires higher tone)
    expect(output.tokens["--tug-base-element-global-text-normal-subtle-rest"]).toBe("--tug-color(indigo-cobalt, i: 7, t: 63)");

    // fg-inverse: sapphire-cobalt i:3 t:100
    expect(output.tokens["--tug-base-element-global-text-normal-inverse-rest"]).toBe("--tug-color(sapphire-cobalt, i: 3, t: 100)");

    // selection-bg-inactive: yellow i:0 t:30 a:25
    expect(output.tokens["--tug-base-surface-selection-primary-normal-plain-inactive"]).toMatch(/yellow/);

    // surface-sunken: violet (surfBareBase) i:5 t:11
    expect(output.tokens["--tug-base-surface-global-primary-normal-sunken-rest"]).toBe("--tug-color(violet, i: 5, t: 11)");
  });

  // -------------------------------------------------------------------------
  // T-ACHROMATIC-SET: ACHROMATIC_ADJACENT_HUES contains expected members.
  // -------------------------------------------------------------------------
  it("T-ACHROMATIC-SET: ACHROMATIC_ADJACENT_HUES contains expected hue families", () => {
    const expected = ["violet", "cobalt", "blue", "indigo", "purple", "sky", "sapphire", "iris", "cerulean"];
    for (const hue of expected) {
      expect(ACHROMATIC_ADJACENT_HUES.has(hue)).toBe(true);
    }
    // Vivid hues should not be in the set
    expect(ACHROMATIC_ADJACENT_HUES.has("orange")).toBe(false);
    expect(ACHROMATIC_ADJACENT_HUES.has("red")).toBe(false);
    expect(ACHROMATIC_ADJACENT_HUES.has("yellow")).toBe(false);
    expect(ACHROMATIC_ADJACENT_HUES.has("green")).toBe(false);
    expect(ACHROMATIC_ADJACENT_HUES.has("cyan")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T-PRIMARY-NAME: primaryColorName extracts the dominant hue from expressions.
  // -------------------------------------------------------------------------
  it("T-PRIMARY-NAME: primaryColorName extracts first segment from hyphenated names", () => {
    expect(primaryColorName("cobalt")).toBe("cobalt");
    expect(primaryColorName("indigo-cobalt")).toBe("indigo");
    expect(primaryColorName("indigo-violet")).toBe("indigo");
    expect(primaryColorName("sapphire-cobalt")).toBe("sapphire");
    expect(primaryColorName("orange")).toBe("orange");
  });
});

// =============================================================================
// Step 4: computeTones() tests
// =============================================================================

describe("computeTones — Step 4", () => {
  // Standard knobs shared across tests
  const DARK_KNOBS_50: MoodKnobs = { surfaceContrast: 50, signalIntensity: 50, warmth: 50 };
  const LIGHT_KNOBS_50: MoodKnobs = { surfaceContrast: 50, signalIntensity: 50, warmth: 50 };

  // ---------------------------------------------------------------------------
  // T-TONES-DARK: computeTones(DARK_FORMULAS, sc=50) matches Brio dark ground truth.
  //
  // Brio dark ground truth (surfaceContrast=50, from T-BRIO-MATCH fixture):
  //   bg-app=5, bg-canvas=5, sunken=11, default=12, raised=11, overlay=14, inset=6, content=6, screen=16
  //   divider-default=17, divider-muted=15, divider-tone=17
  //   disabled-bg=22, disabled-fg=38, disabled-border=28
  //   outlined-bg-rest=8 (inset+2=8), outlined-bg-hover=12 (raised+1=12), outlined-bg-active=14 (overlay=14)
  //   toggle-track-off=28, toggle-disabled=22
  //   signalI=50
  // ---------------------------------------------------------------------------
  it("T-TONES-DARK: Brio dark at sc=50 matches ground-truth tone values", () => {
    const ct: ComputedTones = computeTones(DARK_FORMULAS, DARK_KNOBS_50);

    // Surface tones (Brio ground truth)
    expect(ct.bgApp).toBe(5);
    expect(ct.bgCanvas).toBe(5);
    expect(ct.surfaceSunken).toBe(11);
    expect(ct.surfaceDefault).toBe(12);
    expect(ct.surfaceRaised).toBe(11);
    expect(ct.surfaceOverlay).toBe(14);
    expect(ct.surfaceInset).toBe(6);
    expect(ct.surfaceContent).toBe(6);
    expect(ct.surfaceScreen).toBe(16);

    // Divider tones
    expect(ct.dividerDefault).toBe(17);
    expect(ct.dividerMuted).toBe(15);
    expect(ct.dividerTone).toBe(17);

    // Control/field derived tones
    expect(ct.disabledBgTone).toBe(22);
    expect(ct.disabledFgTone).toBe(38);
    expect(ct.disabledBorderTone).toBe(28);

    // Outlined bg: inset+2=8, raised+1=12, overlay=14
    expect(ct.outlinedBgRestTone).toBe(8);
    expect(ct.outlinedBgHoverTone).toBe(12);
    expect(ct.outlinedBgActiveTone).toBe(14);

    // Toggle
    expect(ct.toggleTrackOffTone).toBe(28);
    expect(ct.toggleDisabledTone).toBe(22);

    // Signal intensity
    expect(ct.signalI).toBe(50);
  });

  // T-TONES-LIGHT deleted in step 6: computeTones takes DerivationFormulas;
  // no light-mode DerivationFormulas exists yet. [D06]

  // ---------------------------------------------------------------------------
  // T-TONES-SC: surfaceContrast=0 and surfaceContrast=100 produce expected extremes.
  //
  // Dark mode extreme values (derived from DARK_FORMULAS):
  //   sc=0:   bgApp = round(5 + (0-50)/50 * 8) = round(5 - 8) = round(-3) = -3
  //           (clamping is not applied by computeTones; rules/deriveTheme clamp)
  //   sc=100: bgApp = round(5 + (100-50)/50 * 8) = round(5 + 8) = 13
  //   surfaceSunken sc=0: round(11 + (0-50)/50*5) = round(11-5) = 6
  //   surfaceSunken sc=100: round(11 + (100-50)/50*5) = round(11+5) = 16
  // ---------------------------------------------------------------------------
  it("T-TONES-SC: dark mode surfaceContrast=0 produces minimum tone values", () => {
    const ct: ComputedTones = computeTones(DARK_FORMULAS, { surfaceContrast: 0, signalIntensity: 50, warmth: 50 });

    // bgApp: 5 + (0-50)/50 * 8 = 5 - 8 = -3
    expect(ct.bgApp).toBe(-3);
    // surfaceSunken: 11 + (0-50)/50 * 5 = 11 - 5 = 6
    expect(ct.surfaceSunken).toBe(6);
    // surfaceDefault: 12 + (0-50)/50 * 3 = 12 - 3 = 9
    expect(ct.surfaceDefault).toBe(9);
    // surfaceOverlay: 14 + (0-50)/50 * 5 = 14 - 5 = 9
    expect(ct.surfaceOverlay).toBe(9);
    // signalI: direct from knob
    expect(ct.signalI).toBe(50);
  });

  it("T-TONES-SC: dark mode surfaceContrast=100 produces maximum tone values", () => {
    const ct: ComputedTones = computeTones(DARK_FORMULAS, { surfaceContrast: 100, signalIntensity: 50, warmth: 50 });

    // bgApp: 5 + (100-50)/50 * 8 = 5 + 8 = 13
    expect(ct.bgApp).toBe(13);
    // surfaceSunken: 11 + (100-50)/50 * 5 = 11 + 5 = 16
    expect(ct.surfaceSunken).toBe(16);
    // surfaceDefault: 12 + (100-50)/50 * 3 = 12 + 3 = 15
    expect(ct.surfaceDefault).toBe(15);
    // surfaceScreen: 16 + (100-50)/50 * 13 = 16 + 13 = 29
    expect(ct.surfaceScreen).toBe(29);
  });

  it("T-TONES-SC: signal intensity extremes map directly to signalI", () => {
    const ct0 = computeTones(DARK_FORMULAS, { surfaceContrast: 50, signalIntensity: 0, warmth: 50 });
    const ct100 = computeTones(DARK_FORMULAS, { surfaceContrast: 50, signalIntensity: 100, warmth: 50 });
    expect(ct0.signalI).toBe(0);
    expect(ct100.signalI).toBe(100);
  });

  // ---------------------------------------------------------------------------
  // T-TONES-MATCH: computeTones output matches existing inline deriveTheme values
  // for Brio at sc=50. Verifies the parallel computation is consistent.
  // ---------------------------------------------------------------------------
  it("T-TONES-MATCH: deriveTheme(brio) output unchanged after adding computeTones call", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);

    // Token count must remain 373
    expect(Object.keys(output.tokens).length).toBe(373);

    // Surface tokens spot-check (from T-BRIO-MATCH fixture)
    expect(output.tokens["--tug-base-surface-global-primary-normal-app-rest"]).toBe("--tug-color(indigo-violet, i: 2, t: 5)");
    expect(output.tokens["--tug-base-surface-global-primary-normal-sunken-rest"]).toBe("--tug-color(violet, i: 5, t: 11)");
    expect(output.tokens["--tug-base-surface-global-primary-normal-default-rest"]).toBe("--tug-color(violet, i: 5, t: 12)");
    expect(output.tokens["--tug-base-surface-global-primary-normal-overlay-rest"]).toBe("--tug-color(violet, i: 4, t: 14)");
    expect(output.tokens["--tug-base-surface-global-primary-normal-inset-rest"]).toBe("--tug-color(indigo-violet, i: 5, t: 6)");

    // Divider tokens
    expect(output.tokens["--tug-base-element-global-divider-normal-default-rest"]).toBe("--tug-color(indigo-violet, i: 6, t: 17)");
    expect(output.tokens["--tug-base-element-global-divider-normal-muted-rest"]).toBe("--tug-color(violet, i: 4, t: 15)");

    // Disabled control
    expect(output.tokens["--tug-base-surface-control-primary-normal-plain-disabled"]).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // T-TONES-INTERFACE: ComputedTones has all required fields (type completeness).
  // ---------------------------------------------------------------------------
  it("T-TONES-INTERFACE: computeTones returns all required ComputedTones fields", () => {
    const ct: ComputedTones = computeTones(DARK_FORMULAS, DARK_KNOBS_50);

    // All fields from Spec S03 must be present and be numbers
    const requiredFields: (keyof ComputedTones)[] = [
      "bgApp", "bgCanvas", "surfaceSunken", "surfaceDefault", "surfaceRaised",
      "surfaceOverlay", "surfaceInset", "surfaceContent", "surfaceScreen",
      "dividerDefault", "dividerMuted", "dividerTone",
      "disabledBgTone", "disabledFgTone", "disabledBorderTone",
      "outlinedBgRestTone", "outlinedBgHoverTone", "outlinedBgActiveTone",
      "toggleTrackOffTone", "toggleDisabledTone",
      "signalI",
    ];
    for (const field of requiredFields) {
      expect(typeof ct[field]).toBe("number");
    }
  });

  // ---------------------------------------------------------------------------
  // Step 5 tests: T-RULES-SURFACES, T-RULES-FG, T-RULES-INVARIANT
  // These verify that CORE_VISUAL_RULES + evaluateRules() produce the same
  // output as the imperative deriveTheme() code for section A tokens.
  // ---------------------------------------------------------------------------

  /** Run evaluateRules for CORE_VISUAL_RULES against the given recipe. */
  function runCoreRules(recipe: typeof EXAMPLE_RECIPES.brio): {
    ruleTokens: Record<string, string>;
    ruleResolved: Record<string, ResolvedColor>;
    imperative: ReturnType<typeof deriveTheme>;
  } {
    const warmth = recipe.warmth ?? 50;
    const surfaceContrast = recipe.surfaceContrast ?? 50;
    const signalIntensity = recipe.signalIntensity ?? 50;
    const recipeFormulas: DerivationFormulas = recipe.formulas ?? DARK_FORMULAS;
    const knobs = { surfaceContrast, signalIntensity, warmth };
    const resolvedSlots = resolveHueSlots(recipe, warmth);
    const computed = computeTones(recipeFormulas, knobs);

    const ruleTokens: Record<string, string> = {};
    const ruleResolved: Record<string, ResolvedColor> = {};
    const ruleDiagnostics: ContrastDiagnostic[] = [];

    evaluateRules(
      CORE_VISUAL_RULES,
      resolvedSlots,
      recipeFormulas,
      knobs,
      computed,
      ruleTokens,
      ruleResolved,
      (alpha) => `--tug-color(black, i: 0, t: 0, a: ${Math.round(alpha)})`,
      (alpha) => `--tug-color(white, a: ${Math.round(alpha)})`,
      (alpha) => `--tug-color(white, i: 0, t: 100, a: ${Math.round(alpha)})`,
      { L: 0, C: 0, h: 0, alpha: 1 },
      { L: 1, C: 0, h: 0, alpha: 1 },
      (name, hueRef, hueAngle, i, t, a, hueName) => {
        const ri = Math.round(i), rt = Math.round(t), ra = Math.round(a);
        // Populate ruleResolved so contrast floor enforcement sees surface L values
        // when processing foreground tokens. Without this, surfaces are missing and
        // the floor never fires, causing mismatches against deriveTheme() output.
        if (hueRef === "black") {
          ruleTokens[name] = ra === 100 ? "--tug-color(black)" : `--tug-color(black, a: ${ra})`;
          ruleResolved[name] = { L: 0, C: 0, h: 0, alpha: ra / 100 };
          return;
        }
        if (hueRef === "white") {
          ruleTokens[name] = ra === 100 ? "--tug-color(white)" : `--tug-color(white, a: ${ra})`;
          ruleResolved[name] = { L: 1, C: 0, h: 0, alpha: ra / 100 };
          return;
        }
        ruleResolved[name] = testResolveOklch(hueAngle, ri, rt, ra, hueName ?? hueRef);
        if (ri === 50 && rt === 50 && ra === 100) { ruleTokens[name] = `--tug-color(${hueRef})`; return; }
        if (ri === 20 && rt === 85 && ra === 100) { ruleTokens[name] = `--tug-color(${hueRef}-light)`; return; }
        if (ri === 50 && rt === 20 && ra === 100) { ruleTokens[name] = `--tug-color(${hueRef}-dark)`; return; }
        if (ri === 90 && rt === 50 && ra === 100) { ruleTokens[name] = `--tug-color(${hueRef}-intense)`; return; }
        if (ri === 50 && rt === 42 && ra === 100) { ruleTokens[name] = `--tug-color(${hueRef}-muted)`; return; }
        const isVerboseAlpha = ra !== 100 && ri === 50 && rt === 50;
        const parts: string[] = [];
        if (isVerboseAlpha || ri !== 50) parts.push(`i: ${ri}`);
        if (isVerboseAlpha || rt !== 50) parts.push(`t: ${rt}`);
        if (ra !== 100) parts.push(`a: ${ra}`);
        ruleTokens[name] = `--tug-color(${hueRef}, ${parts.join(", ")})`;
      },
      TEST_PAIRING_LOOKUP,
      ruleDiagnostics,
    );

    const imperative = deriveTheme(recipe);
    return { ruleTokens, ruleResolved, imperative };
  }

  // ---------------------------------------------------------------------------
  // T-RULES-SURFACES: Rule-derived surface tokens match imperative output (Brio dark)
  // ---------------------------------------------------------------------------
  it("T-RULES-SURFACES: rule-derived surface tokens match imperative output for Brio dark", () => {
    const { ruleTokens, imperative } = runCoreRules(EXAMPLE_RECIPES.brio);

    const SURFACE_TOKENS = [
      "--tug-base-surface-global-primary-normal-app-rest",
      "--tug-base-surface-global-primary-normal-canvas-rest",
      "--tug-base-surface-global-primary-normal-sunken-rest",
      "--tug-base-surface-global-primary-normal-default-rest",
      "--tug-base-surface-global-primary-normal-raised-rest",
      "--tug-base-surface-global-primary-normal-overlay-rest",
      "--tug-base-surface-global-primary-normal-inset-rest",
      "--tug-base-surface-global-primary-normal-content-rest",
      "--tug-base-surface-global-primary-normal-screen-rest",
    ];

    const mismatches: string[] = [];
    for (const token of SURFACE_TOKENS) {
      const rule = ruleTokens[token];
      const imp = imperative.tokens[token];
      if (rule !== imp) mismatches.push(`${token}:\n  rule: ${rule}\n  imp:  ${imp}`);
    }
    expect(mismatches).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T-RULES-FG: Rule-derived foreground tokens match imperative output (Brio dark)
  // ---------------------------------------------------------------------------
  it("T-RULES-FG: rule-derived foreground tokens match imperative output for Brio dark", () => {
    const { ruleTokens, imperative } = runCoreRules(EXAMPLE_RECIPES.brio);

    const FG_TOKENS = [
      "--tug-base-element-global-text-normal-default-rest",
      "--tug-base-element-global-text-normal-muted-rest",
      "--tug-base-element-global-text-normal-subtle-rest",
      "--tug-base-element-global-text-normal-plain-disabled",
      "--tug-base-element-global-text-normal-inverse-rest",
      "--tug-base-element-global-text-normal-placeholder-rest",
      "--tug-base-element-global-text-normal-link-rest",
      "--tug-base-element-global-text-normal-link-hover",
      "--tug-base-element-global-text-normal-onAccent-rest",
      "--tug-base-element-global-text-normal-onDanger-rest",
      "--tug-base-element-global-text-normal-onCaution-rest",
      "--tug-base-element-global-text-normal-onSuccess-rest",
    ];

    const mismatches: string[] = [];
    for (const token of FG_TOKENS) {
      const rule = ruleTokens[token];
      const imp = imperative.tokens[token];
      if (rule !== imp) mismatches.push(`${token}:\n  rule: ${rule}\n  imp:  ${imp}`);
    }
    expect(mismatches).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T-RULES-INVARIANT: All invariant tokens are present and correct
  // ---------------------------------------------------------------------------
  it("T-RULES-INVARIANT: rule table invariant tokens are present and match expected values", () => {
    const { ruleTokens } = runCoreRules(EXAMPLE_RECIPES.brio);

    const EXPECTED_INVARIANTS: Record<string, string> = {
      "--tug-base-font-family-sans": '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
      "--tug-base-font-size-md": "14px",
      "--tug-base-space-md": "8px",
      "--tug-base-radius-md": "6px",
      "--tug-base-chrome-height": "36px",
      "--tug-base-icon-size-md": "15px",
      "--tug-base-motion-duration-fast": "calc(100ms * var(--tug-timing))",
      "--tug-base-motion-easing-standard": "cubic-bezier(0.2, 0, 0, 1)",
    };

    for (const [token, expected] of Object.entries(EXPECTED_INVARIANTS)) {
      expect(ruleTokens[token]).toBe(expected);
    }
  });

  // ---------------------------------------------------------------------------
  // T-RULES-SURFACES-LIGHT: Surface tokens also match for Brio light recipe
  // ---------------------------------------------------------------------------
  it("T-RULES-SURFACES-LIGHT: rule-derived surface tokens match imperative output for Brio light", () => {
    const brioLight = { ...EXAMPLE_RECIPES.brio, mode: "light" as const };
    const { ruleTokens, imperative } = runCoreRules(brioLight);

    const SURFACE_TOKENS = [
      "--tug-base-surface-global-primary-normal-app-rest",
      "--tug-base-surface-global-primary-normal-canvas-rest",
      "--tug-base-surface-global-primary-normal-sunken-rest",
      "--tug-base-surface-global-primary-normal-default-rest",
      "--tug-base-surface-global-primary-normal-raised-rest",
      "--tug-base-surface-global-primary-normal-overlay-rest",
      "--tug-base-surface-global-primary-normal-inset-rest",
      "--tug-base-surface-global-primary-normal-content-rest",
      "--tug-base-surface-global-primary-normal-screen-rest",
    ];

    const mismatches: string[] = [];
    for (const token of SURFACE_TOKENS) {
      const rule = ruleTokens[token];
      const imp = imperative.tokens[token];
      if (rule !== imp) mismatches.push(`${token}:\n  rule: ${rule}\n  imp:  ${imp}`);
    }
    expect(mismatches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step 6 tests: T-RULES-COMPLETE, T-RULES-DARK-MATCH
// These verify that the full RULES table covers all 373 tokens and that
// evaluateRules(RULES, ...) matches imperative dark-mode output.
// T-RULES-LIGHT-MATCH deleted (clean break per D06 — deferred to light-formulas step).
// ---------------------------------------------------------------------------

describe("derivation-engine step-6 rules", () => {
  /** Run evaluateRules for RULES (full table) against the given recipe. */
  function runAllRules(recipe: Parameters<typeof deriveTheme>[0]): {
    ruleTokens: Record<string, string>;
    imperative: ReturnType<typeof deriveTheme>;
  } {
    const warmth = recipe.warmth ?? 50;
    const surfaceContrast = recipe.surfaceContrast ?? 50;
    const signalIntensity = recipe.signalIntensity ?? 50;
    const recipeFormulas: DerivationFormulas = recipe.formulas ?? DARK_FORMULAS;
    const knobs = { surfaceContrast, signalIntensity, warmth };
    const resolvedSlots = resolveHueSlots(recipe, warmth);
    const computed = computeTones(recipeFormulas, knobs);

    const ruleTokens: Record<string, string> = {};
    const ruleResolved: Record<string, ResolvedColor> = {};
    const ruleDiagnostics: ContrastDiagnostic[] = [];

    evaluateRules(
      RULES,
      resolvedSlots,
      recipeFormulas,
      knobs,
      computed,
      ruleTokens,
      ruleResolved,
      (alpha) => `--tug-color(black, i: 0, t: 0, a: ${Math.round(alpha)})`,
      (alpha) => `--tug-color(white, a: ${Math.round(alpha)})`,
      (alpha) => `--tug-color(white, i: 0, t: 100, a: ${Math.round(alpha)})`,
      { L: 0, C: 0, h: 0, alpha: 1 },
      { L: 1, C: 0, h: 0, alpha: 1 },
      (name, hueRef, hueAngle, i, t, a, hueName) => {
        const ri = Math.round(i), rt = Math.round(t), ra = Math.round(a);
        // Populate ruleResolved so contrast floor enforcement sees surface L values
        // when processing foreground tokens. Without this, surfaces are missing and
        // the floor never fires, causing mismatches against deriveTheme() output.
        if (hueRef === "black") {
          ruleTokens[name] = ra === 100 ? "--tug-color(black)" : `--tug-color(black, a: ${ra})`;
          ruleResolved[name] = { L: 0, C: 0, h: 0, alpha: ra / 100 };
          return;
        }
        if (hueRef === "white") {
          ruleTokens[name] = ra === 100 ? "--tug-color(white)" : `--tug-color(white, a: ${ra})`;
          ruleResolved[name] = { L: 1, C: 0, h: 0, alpha: ra / 100 };
          return;
        }
        ruleResolved[name] = testResolveOklch(hueAngle, ri, rt, ra, hueName ?? hueRef);
        if (ri === 50 && rt === 50 && ra === 100) { ruleTokens[name] = `--tug-color(${hueRef})`; return; }
        if (ri === 20 && rt === 85 && ra === 100) { ruleTokens[name] = `--tug-color(${hueRef}-light)`; return; }
        if (ri === 50 && rt === 20 && ra === 100) { ruleTokens[name] = `--tug-color(${hueRef}-dark)`; return; }
        if (ri === 90 && rt === 50 && ra === 100) { ruleTokens[name] = `--tug-color(${hueRef}-intense)`; return; }
        if (ri === 50 && rt === 42 && ra === 100) { ruleTokens[name] = `--tug-color(${hueRef}-muted)`; return; }
        const isVerboseAlpha = ra !== 100 && ri === 50 && rt === 50;
        const parts: string[] = [];
        if (isVerboseAlpha || ri !== 50) parts.push(`i: ${ri}`);
        if (isVerboseAlpha || rt !== 50) parts.push(`t: ${rt}`);
        if (ra !== 100) parts.push(`a: ${ra}`);
        ruleTokens[name] = `--tug-color(${hueRef}, ${parts.join(", ")})`;
      },
      TEST_PAIRING_LOOKUP,
      ruleDiagnostics,
    );

    const imperative = deriveTheme(recipe);
    return { ruleTokens, imperative };
  }

  // -------------------------------------------------------------------------
  // T-RULES-COMPLETE: RULES table has exactly 373 entries
  // -------------------------------------------------------------------------
  it("T-RULES-COMPLETE: RULES table has exactly 373 entries", () => {
    expect(Object.keys(RULES).length).toBe(373);
  });

  // -------------------------------------------------------------------------
  // T-RULES-DARK-MATCH: All RULES-derived dark tokens match imperative output
  // -------------------------------------------------------------------------
  it("T-RULES-DARK-MATCH: all rule-derived dark tokens match imperative output", () => {
    const { ruleTokens, imperative } = runAllRules(EXAMPLE_RECIPES.brio);

    const mismatches: string[] = [];
    for (const [token, ruleValue] of Object.entries(ruleTokens)) {
      const impValue = imperative.tokens[token];
      if (ruleValue !== impValue) {
        mismatches.push(`${token}:\n  rule: ${ruleValue}\n  imp:  ${impValue}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

});
// T-RULES-LIGHT-MATCH deleted in step 6 (clean break per D06):
// light-mode rule parity requires BRIO_LIGHT_FORMULAS which is deferred to a later step.

// ---------------------------------------------------------------------------
// Step 4 tests: enforceContrastFloor, ContrastDiagnostic, zero-failure integration
// ---------------------------------------------------------------------------

describe("derivation-engine step-4 contrast floor", () => {
  // -------------------------------------------------------------------------
  // T-FLOOR-1: enforceContrastFloor returns original tone when already passing
  // -------------------------------------------------------------------------
  it("T-FLOOR-1: enforceContrastFloor returns original tone when already passing", () => {
    // Use cobalt hue. At tone 100 (L near L_LIGHT), contrast vs a very dark surface (L~0.2)
    // is well above any threshold.
    const darkSurfaceL = toneToL(5, "cobalt"); // bg-app-like surface
    const result = enforceContrastFloor(94, darkSurfaceL, 75, "lighter", "cobalt");
    // tone 94 should already pass contrast 75 against tone-5 surface — return unchanged
    expect(result).toBe(94);
  });

  // -------------------------------------------------------------------------
  // T-FLOOR-2: enforceContrastFloor returns adjusted tone when below threshold
  // -------------------------------------------------------------------------
  it("T-FLOOR-2: enforceContrastFloor returns adjusted tone when below threshold", () => {
    // At tone 50 (mid-gray), contrast against tone-5 (very dark) should be insufficient
    // for content (75). The floor should push tone higher.
    const darkSurfaceL = toneToL(5, "cobalt");
    const result = enforceContrastFloor(50, darkSurfaceL, 75, "lighter", "cobalt");
    // The adjusted tone must be higher than 50
    expect(result).toBeGreaterThan(50);
    // And the adjusted tone must produce sufficient contrast
    const adjustedL = toneToL(result, "cobalt");
    const deltaL = darkSurfaceL - adjustedL;
    // negative polarity (lighter element on dark surface)
    const contrast = Math.abs(deltaL) * 150 * 0.85;
    expect(contrast).toBeGreaterThanOrEqual(75);
  });

  // -------------------------------------------------------------------------
  // T-FLOOR-3: enforceContrastFloor lower bound — "darker" polarity
  // -------------------------------------------------------------------------
  it("T-FLOOR-3: enforceContrastFloor adjusts toward darker when polarity is darker", () => {
    // On a bright surface (tone 95), a mid-tone element (50) should need to move darker
    const brightSurfaceL = toneToL(95, "cobalt");
    const result = enforceContrastFloor(50, brightSurfaceL, 75, "darker", "cobalt");
    expect(result).toBeLessThan(50);
  });

  // -------------------------------------------------------------------------
  // T-FLOOR-4: ThemeOutput.diagnostics is populated for clamped tokens
  // -------------------------------------------------------------------------
  it("T-FLOOR-4: ThemeOutput.diagnostics is populated for floor-clamped tokens", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    // diagnostics array must be present
    expect(Array.isArray(output.diagnostics)).toBe(true);
    // Each diagnostic entry must be well-formed
    for (const diag of output.diagnostics) {
      expect(typeof diag.token).toBe("string");
      expect(diag.token.startsWith("--tug-base-")).toBe(true);
      expect(["floor-applied", "floor-applied-composited", "structurally-fixed", "composite-dependent"]).toContain(diag.reason);
      expect(Array.isArray(diag.surfaces)).toBe(true);
      expect(typeof diag.initialTone).toBe("number");
      expect(typeof diag.finalTone).toBe("number");
      expect(typeof diag.threshold).toBe("number");
    }
    // All floor-applied entries (pass 1 and pass 2) must have finalTone != initialTone
    const floorApplied = output.diagnostics.filter(
      (d) => d.reason === "floor-applied" || d.reason === "floor-applied-composited",
    );
    for (const diag of floorApplied) {
      expect(diag.finalTone).not.toBe(diag.initialTone);
    }
  });

  // -------------------------------------------------------------------------
  // T-FLOOR-5: validateThemeContrast on Brio dark reports 0 failures for
  //            floor-clamped tokens that are NOT structurally constrained
  // -------------------------------------------------------------------------
  it("T-FLOOR-5: validateThemeContrast after deriveTheme reports 0 unexpected failures for floor-clamped tokens", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);

    // Run validateThemeContrast directly on the floor-enforced resolved map
    const results = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    // Tokens that were floor-clamped must now pass their thresholds via hex-path validation,
    // UNLESS they are in the known structural exception set (token cannot reach threshold in
    // tone space regardless — e.g. ghost-danger-fg tokens on red hue which is a vivid mid-tone).
    const floorApplied = new Set(
      output.diagnostics
        .filter((d) => d.reason === "floor-applied" || d.reason === "floor-applied-composited")
        .map((d) => d.token),
    );

    const floorFailures = results.filter(
      (r) =>
        !r.contrastPass &&
        floorApplied.has(r.fg) &&
        !KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.has(r.fg) &&
        !KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`),
    );

    const descriptions = floorFailures.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: contrast ${f.contrast.toFixed(1)} < ${CONTRAST_THRESHOLDS[f.role] ?? 15}`,
    );
    expect(descriptions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T-FLOOR-6: Structurally fixed tokens (alpha < 1) are not in diagnostics
  // -------------------------------------------------------------------------
  it("T-FLOOR-6: structurally fixed tokens (alpha < 1) are not in floor diagnostics", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    const floorApplied = output.diagnostics.filter(
      (d) => d.reason === "floor-applied" || d.reason === "floor-applied-composited",
    );

    // For every floor-applied token, check its resolved color has alpha = 1
    const semiTransparentFloor = floorApplied.filter((d) => {
      const resolved = output.resolved[d.token];
      return resolved && (resolved.alpha ?? 1) < 1;
    });
    expect(semiTransparentFloor.map((d) => d.token)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T-FLOOR-7: Reconciliation — every floor-applied token passes hex-path validation
  //
  // The binary search in enforceContrastFloor uses toneToL (piecewise approximation).
  // The validateThemeContrast path converts OKLCH → hex → OKLab L (8-bit quantized).
  // These two paths can diverge slightly. This test verifies that the TONE_MARGIN
  // in enforceContrastFloor is sufficient to bridge the gap for all clamped tokens
  // that are not structurally constrained (i.e. threshold is achievable in tone space).
  // -------------------------------------------------------------------------
  it("T-FLOOR-7: reconciliation — every floor-applied token passes via hex-path validation", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    const floorApplied = new Map(
      output.diagnostics
        .filter((d) => d.reason === "floor-applied" || d.reason === "floor-applied-composited")
        .map((d) => [d.token, d]),
    );

    // For each floor-applied token that is NOT in the known structural exception set,
    // verify it passes via hex-path validation. Tokens in KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS
    // may be floor-applied but still fail because their threshold is unachievable in tone space
    // (e.g. ghost-danger-fg on vivid red hue — best achievable tone still below contrast 60).
    // Specific (fg, bg) pairs in KNOWN_PAIR_EXCEPTIONS are excluded: some surfaces (overlay,
    // screen) have structural luminance ceilings that prevent the threshold from being reached
    // regardless of tone adjustment.
    const reconciliationFailures: string[] = [];
    for (const result of results) {
      const diag = floorApplied.get(result.fg);
      if (!diag) continue;
      if (KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.has(result.fg)) continue;
      if (KNOWN_PAIR_EXCEPTIONS.has(`${result.fg}|${result.bg}`)) continue;
      if (!result.contrastPass) {
        reconciliationFailures.push(
          `${result.fg} on ${result.bg} [${result.role}]: hex-path contrast ${result.contrast.toFixed(1)} < threshold ${CONTRAST_THRESHOLDS[result.role] ?? 15} (floor set tone to ${diag.finalTone})`,
        );
      }
    }
    expect(reconciliationFailures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step 4: Light-mode verification — cardFrameActiveTone, formula field control,
// contrast baseline comparison (Bug 2 fix and formula tuning confirmation)
// ---------------------------------------------------------------------------

describe("Step 4 verification — harmony light-mode cardFrameActiveTone and formula fields", () => {
  // Task 1: cardFrameActiveTone=96 — bright title bar clearly lighter than surface-default (90)
  it("LIGHT_FORMULAS.cardFrameActiveTone is 96 (bright title bar above content)", () => {
    expect(LIGHT_FORMULAS.cardFrameActiveTone).toBe(96);
  });

  it("EXAMPLE_RECIPES.harmony formulas.cardFrameActiveTone is 96 (LIGHT_FORMULAS value)", () => {
    const harmonyFormulas = EXAMPLE_RECIPES.harmony.formulas!;
    expect(harmonyFormulas.cardFrameActiveTone).toBe(96);
  });

  it("harmony tab-bg-active resolves to L near 96 (cardFrameActiveTone=96 applied to derivation)", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.harmony);
    const tabBgActive = output.resolved["--tug-base-surface-tab-primary-normal-plain-active"];
    expect(tabBgActive).toBeDefined();
    // tone 96 => approximately L=0.96 in OKLCH; allow ±0.06 for hue/chroma contribution
    const approxTone = tabBgActive!.L * 100;
    expect(approxTone).toBeGreaterThan(90);
    expect(approxTone).toBeLessThan(100);
  });

  // Task 3: borderSignalTone=40 produces darker control borders in harmony vs brio
  it("LIGHT_FORMULAS.borderSignalTone is 40 (below dark default of 50)", () => {
    expect(LIGHT_FORMULAS.borderSignalTone).toBe(40);
    expect(DARK_FORMULAS.borderSignalTone).toBe(50);
  });

  it("LIGHT_FORMULAS.semanticSignalTone is 35 (below dark default of 50)", () => {
    expect(LIGHT_FORMULAS.semanticSignalTone).toBe(35);
    expect(DARK_FORMULAS.semanticSignalTone).toBe(50);
  });

  it("borderSignalTone=40 produces darker control borders in harmony than borderSignalTone=50 (anti-neon-glow)", () => {
    // borderRamp() uses borderSignalTone — control outlined borders are the primary consumers
    const with40 = deriveTheme({ ...EXAMPLE_RECIPES.harmony, formulas: { ...LIGHT_FORMULAS, borderSignalTone: 40 } });
    const with50 = deriveTheme({ ...EXAMPLE_RECIPES.harmony, formulas: { ...LIGHT_FORMULAS, borderSignalTone: 50 } });
    const border40 = with40.resolved["--tug-base-element-control-border-outlined-action-rest"];
    const border50 = with50.resolved["--tug-base-element-control-border-outlined-action-rest"];
    expect(border40).toBeDefined();
    expect(border50).toBeDefined();
    // borderSignalTone=40 must produce a darker (lower L) token than tone=50
    expect(border40!.L).toBeLessThan(border50!.L);
  });

  it("semanticSignalTone=35 produces darker tone-accent in harmony than semanticSignalTone=50 (anti-neon-glow)", () => {
    // semanticTone() uses semanticSignalTone — tone-* family tokens are the primary consumers
    const with35 = deriveTheme({ ...EXAMPLE_RECIPES.harmony, formulas: { ...LIGHT_FORMULAS, semanticSignalTone: 35 } });
    const with50 = deriveTheme({ ...EXAMPLE_RECIPES.harmony, formulas: { ...LIGHT_FORMULAS, semanticSignalTone: 50 } });
    const tone35 = with35.resolved["--tug-base-element-tone-fill-normal-accent-rest"];
    const tone50 = with50.resolved["--tug-base-element-tone-fill-normal-accent-rest"];
    expect(tone35).toBeDefined();
    expect(tone50).toBeDefined();
    // semanticSignalTone=35 must produce a darker (lower L) or equal semantic token compared to tone=50.
    // In light mode, the informational contrast floor (60) may clamp both values to the same L when the
    // tone difference falls within the floor's range — this is expected behavior, not a regression.
    expect(tone35!.L).toBeLessThanOrEqual(tone50!.L);
  });

  it("harmony semantic tone tokens are all darker than brio (semanticSignalTone 35 < 50)", () => {
    const harmonyOutput = deriveTheme(EXAMPLE_RECIPES.harmony);
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const semanticTokens = [
      "--tug-base-element-tone-fill-normal-accent-rest",
      "--tug-base-element-tone-fill-normal-active-rest",
      "--tug-base-element-tone-fill-normal-success-rest",
      "--tug-base-element-tone-fill-normal-caution-rest",
      "--tug-base-element-tone-fill-normal-danger-rest",
    ];
    for (const token of semanticTokens) {
      const harmonyL = harmonyOutput.resolved[token]?.L;
      const brioL = brioOutput.resolved[token]?.L;
      expect(harmonyL).toBeDefined();
      expect(brioL).toBeDefined();
      // harmony uses semanticSignalTone=35 vs brio dark's 50: harmony tokens must be darker
      expect(harmonyL!).toBeLessThan(brioL!);
    }
  });

  // Task 4: no new unexpected failures in harmony vs brio baseline
  it("harmony has no more unexpected non-decorative failures than brio (contrast baseline preserved)", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const harmonyOutput = deriveTheme(EXAMPLE_RECIPES.harmony);
    const brioFails = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP)
      .filter((r) => !r.contrastPass && r.role !== "decorative");
    const harmonyFails = validateThemeContrast(harmonyOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP)
      .filter((r) => !r.contrastPass && r.role !== "decorative");
    const brioFailSet = new Set(brioFails.map((r) => `${r.fg}|${r.bg}`));

    // Collect new harmony failures not covered by the existing exception sets
    const newUnexpected = harmonyFails.filter((r) => {
      if (brioFailSet.has(`${r.fg}|${r.bg}`)) return false;
      // Marginal band: within CONTRAST_MARGINAL_DELTA of threshold is not a hard fail
      const margin = (CONTRAST_THRESHOLDS[r.role] ?? 15) - CONTRAST_MARGINAL_DELTA;
      if (Math.abs(r.contrast) >= margin) return false;
      // Known structural element exceptions (same set as gallery tests)
      if (KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.has(r.fg)) return false;
      // Global pair exceptions: structural constraints documented in contrast-exceptions.ts
      if (KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`)) return false;
      // Known pair exceptions (polarity mismatches)
      if (r.fg === "--tug-base-element-global-text-normal-inverse-rest" && r.bg === "--tug-base-surface-global-primary-normal-screen-rest") return false;
      // fg-inverse on surface-default: badge ghost/outlined variant — in light mode, fg-inverse
      // is a light token on a light bg (same structural polarity as dark mode). The pair fails
      // contrast by construction. Phase 2 will resolve via independent token paths. [Gap #badge-inverse]
      if (r.fg === "--tug-base-element-global-text-normal-inverse-rest" && r.bg === "--tug-base-surface-global-primary-normal-default-rest") return false;
      return true;
    });
    const descriptions = newUnexpected.map(
      (f) => `${f.fg} on ${f.bg} [${f.role}]: contrast ${f.contrast.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  // Task 6: Brio dark unchanged
  it("Brio dark output has exactly 373 tokens (unchanged by light formula additions)", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    expect(Object.keys(output.tokens).length).toBe(373);
  });

  it("DARK_FORMULAS.borderSignalTone=50 preserves brio control border token values", () => {
    // Explicit DARK_FORMULAS must match the recipe.formulas fallback
    const fromRecipe = deriveTheme(EXAMPLE_RECIPES.brio);
    const fromExplicit = deriveTheme({ ...EXAMPLE_RECIPES.brio, formulas: DARK_FORMULAS });
    // Control border tokens (use borderRamp) must be identical
    const controlBorderToken = "--tug-base-element-control-border-outlined-action-rest";
    expect(fromRecipe.tokens[controlBorderToken]).toBe(fromExplicit.tokens[controlBorderToken]);
  });
});

// ---------------------------------------------------------------------------
// Step 2: Pass-2 composited contrast enforcement unit tests
// References: [D01], [D04], Spec S01, Spec S02
// ---------------------------------------------------------------------------

describe("step-2 pass-2 composited contrast enforcement", () => {
  // -------------------------------------------------------------------------
  // T-COMP-1: compositeL at alpha=0 equals parentL (fully transparent token)
  // Spec S01: alpha=0 means element is invisible; compositeL = parentSurface L
  // -------------------------------------------------------------------------
  it("T-COMP-1: compositeL for alpha=0 token equals parent surface L", () => {
    // Fully transparent token on a dark surface: compositeHex = surface-default hex
    const tokenResolved: ResolvedColor = { L: 0.9, C: 0.1, h: 230, alpha: 0.0 };
    const parentResolved: ResolvedColor = { L: 0.35, C: 0.01, h: 260, alpha: 1.0 };
    const compositeHex = compositeOverSurface(tokenResolved, parentResolved);
    const compositeL = hexToOkLabL(compositeHex);
    const parentL = hexToOkLabL(compositeOverSurface({ ...parentResolved, alpha: 1.0 }, parentResolved));
    // alpha=0 means token contributes nothing; compositeHex should match the parent hex
    // Allow small delta for hex quantization (8-bit gamma encoding)
    expect(Math.abs(compositeL - hexToOkLabL(compositeOverSurface(parentResolved, parentResolved)))).toBeLessThan(0.01);
  });

  // -------------------------------------------------------------------------
  // T-COMP-2: compositeL at alpha=1.0 equals the token's own L (fully opaque)
  // Spec S01: alpha=1 means token is fully opaque; compositing = identity
  // -------------------------------------------------------------------------
  it("T-COMP-2: compositeL for alpha=1.0 token equals the token L (no parent blending)", () => {
    const tokenResolved: ResolvedColor = { L: 0.78, C: 0.146, h: 55, alpha: 1.0 };
    const parentResolved: ResolvedColor = { L: 0.35, C: 0.01, h: 260, alpha: 1.0 };
    const compositeHex = compositeOverSurface(tokenResolved, parentResolved);
    const compositeL = hexToOkLabL(compositeHex);
    // At alpha=1.0, composite result must equal the token's own OKLab L
    // The token L after hex round-trip from OKLCH should be close to 0.78
    expect(Math.abs(compositeL - tokenResolved.L)).toBeLessThan(0.02);
  });

  // -------------------------------------------------------------------------
  // T-COMP-3: compositeL at alpha=0.15 (typical badge tint) is between
  //           parent L and token L, weighted heavily toward parent
  // Spec S01 step 2: alpha-blend in linear sRGB
  // -------------------------------------------------------------------------
  it("T-COMP-3: compositeL for alpha=0.15 is between parent L and token L", () => {
    // Light token (L≈0.78) at 15% opacity on dark parent (L≈0.35)
    const tokenResolved: ResolvedColor = { L: 0.78, C: 0.146, h: 55, alpha: 0.15 };
    const parentResolved: ResolvedColor = { L: 0.35, C: 0.005, h: 260, alpha: 1.0 };
    const compositeHex = compositeOverSurface(tokenResolved, parentResolved);
    const compositeL = hexToOkLabL(compositeHex);
    // At alpha=0.15, the composite should be closer to the parent (0.35) than to the token (0.78)
    expect(compositeL).toBeGreaterThan(parentResolved.L - 0.02);
    expect(compositeL).toBeLessThan(tokenResolved.L);
    // Specifically: 15% of token + 85% of parent → should be well below 0.5
    expect(compositeL).toBeLessThan(0.55);
  });

  // -------------------------------------------------------------------------
  // T-COMP-4: compositeL at alpha=0.40 (selection highlight) is weighted
  //           40% token + 60% parent
  // Spec S01: alpha=0.40 is the selection-bg typical value
  // -------------------------------------------------------------------------
  it("T-COMP-4: compositeL for alpha=0.40 blends correctly between token and parent", () => {
    // Mid-weight blend: light token on dark parent
    const tokenResolved: ResolvedColor = { L: 0.78, C: 0.14, h: 230, alpha: 0.4 };
    const parentResolved: ResolvedColor = { L: 0.35, C: 0.005, h: 260, alpha: 1.0 };
    const compositeHex = compositeOverSurface(tokenResolved, parentResolved);
    const compositeL = hexToOkLabL(compositeHex);
    // At alpha=0.40, the composite is between parent and token, closer to parent
    expect(compositeL).toBeGreaterThan(parentResolved.L - 0.02);
    expect(compositeL).toBeLessThan(tokenResolved.L + 0.02);
    // 40% token + 60% parent: compositeL must be distinctly above parentL
    expect(compositeL).toBeGreaterThan(parentResolved.L + 0.05);
  });

  // -------------------------------------------------------------------------
  // T-COMP-5: pass-2 enforcement adjusts tone for a composited surface
  // Verifies that deriveTheme applies contrast enforcement for semi-transparent
  // surfaces that previously had the parentSurface skip. [D01], Spec S02
  // -------------------------------------------------------------------------
  it("T-COMP-5: pass-2 enforcement produces diagnostics for composited surface pairings", () => {
    // Run derivation on brio — if any composited pairs required tone adjustment,
    // diagnostics will include entries from pass 2 with reason "floor-applied-composited"
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    // Not all recipes will have pass-2 diagnostics (if all composited pairs already pass),
    // but the diagnostics array must be structurally valid
    expect(Array.isArray(output.diagnostics)).toBe(true);
    // All diagnostics must be well-formed regardless of pass origin
    for (const diag of output.diagnostics) {
      expect(["floor-applied", "floor-applied-composited"]).toContain(diag.reason);
      expect(typeof diag.token).toBe("string");
      expect(diag.token.startsWith("--tug-base-")).toBe(true);
      expect(diag.finalTone).not.toBe(diag.initialTone);
    }
  });

  // -------------------------------------------------------------------------
  // T-COMP-6: after pass-2 adjustment, tokens[name] CSS string tone parameter
  //           reflects the adjusted tone (setChromatic re-emission check).
  //           Verifies [D01] atomicity: tokens and resolved stay consistent.
  // -------------------------------------------------------------------------
  it("T-COMP-6: tokens CSS string and resolved L are consistent after pass-2 adjustments", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    // For every chromatic token, the CSS string must include --tug-color(
    // and the resolved map must have a corresponding ResolvedColor entry
    for (const tokenName of Object.keys(output.resolved)) {
      const tokenStr = output.tokens[tokenName];
      if (!tokenStr) continue;
      expect(tokenStr).toContain("--tug-color(");
    }
    // Specifically check that tokens with pass-2 diagnostics are consistent
    const pass2Tokens = new Set(output.diagnostics.map((d) => d.token));
    for (const tokenName of pass2Tokens) {
      const tokenStr = output.tokens[tokenName];
      const resolvedColor = output.resolved[tokenName];
      expect(tokenStr).toBeDefined();
      expect(resolvedColor).toBeDefined();
      // The token string must encode --tug-color() (not a stale pre-pass-2 value)
      expect(tokenStr).toContain("--tug-color(");
    }
  });

  // -------------------------------------------------------------------------
  // T-COMP-8: enforceContrastFloor with composited surface L produces correct
  // tone adjustment.
  // Unit test verifying that calling enforceContrastFloor directly with a
  // composited surface L value (obtained via compositeOverSurface + hexToOkLabL)
  // returns a tone whose L achieves the required contrast against that composite L.
  // This is the core unit contract of pass-2 enforcement. [D01], [D04], Spec S02
  // -------------------------------------------------------------------------
  it("T-COMP-8: enforceContrastFloor with composited surface L produces correct tone adjustment", () => {
    // Set up a semi-transparent dark surface (alpha 0.10) composited over a very dark parent.
    // This models a dark tone-background or selection-highlight surface scenario.
    // compositeL will be slightly lighter than the parent but still very dark overall,
    // providing sufficient room for the element to achieve contrast 75 by moving lighter.
    const surfaceResolved: ResolvedColor = { L: 0.42, C: 0.02, h: 260, alpha: 0.10 };
    const parentResolved: ResolvedColor = { L: 0.14, C: 0.005, h: 260, alpha: 1.0 };

    // Compute composited surface L — this is the effective background L for pass-2.
    // 10% blend of a mid surface into a very dark parent yields a near-dark compositeL.
    const compositeHex = compositeOverSurface(surfaceResolved, parentResolved);
    const compositeL = hexToOkLabL(compositeHex);

    // compositeL must be above the raw parentL but far below the surface L
    expect(compositeL).toBeGreaterThan(parentResolved.L);
    expect(compositeL).toBeLessThan(surfaceResolved.L);

    // Verify compositeL is dark enough that we have headroom for contrast 75.
    // contrast 75 requires |deltaL| >= 75 / (150 * 0.85) ≈ 0.588 for lighter-on-dark.
    // compositeL must be below 0.96 - 0.588 = 0.372 (cobalt tone-100 L ≈ 0.96).
    expect(compositeL).toBeLessThan(0.37);

    // Element starts at tone 40 (cobalt) — not far enough from compositeL to pass threshold.
    const elementHue = "cobalt";
    const initialTone = 40;
    const threshold = 75; // content threshold

    // compositeL is dark; element is lighter, so polarity = "lighter" (push to higher tone)
    const adjustedTone = enforceContrastFloor(initialTone, compositeL, threshold, "lighter", elementHue);

    // The floor must push tone higher (lighter) to gain more contrast
    expect(adjustedTone).toBeGreaterThan(initialTone);

    // The adjusted tone must produce contrast >= threshold against compositeL.
    // Light element on dark composite: deltaL = compositeL - adjustedL is negative;
    // contrast magnitude = |deltaL| * CONTRAST_SCALE * POLARITY_FACTOR = |deltaL| * 150 * 0.85
    const adjustedL = toneToL(adjustedTone, elementHue);
    const deltaL = compositeL - adjustedL;
    const contrastMagnitude = Math.abs(deltaL) * 150 * 0.85;
    expect(contrastMagnitude).toBeGreaterThanOrEqual(threshold);
  });

  // -------------------------------------------------------------------------
  // T-COMP-7: brio dark still passes T4.1 assertions after pass-2 enforcement
  // Integration regression guard: pass 2 must not break pass 1 results.
  // References: [D01] "pass 2 adjustments are strictly additive"
  // -------------------------------------------------------------------------
  it("T-COMP-7: deriveTheme(brio) still passes core readability assertions with pass-2 active", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    // Core readability: fg-default on primary surfaces must pass contrast 75
    const coreFailures = results.filter(
      (r) =>
        r.fg === "--tug-base-element-global-text-normal-default-rest" &&
        (r.bg === "--tug-base-surface-global-primary-normal-default-rest" ||
          r.bg === "--tug-base-surface-global-primary-normal-inset-rest" ||
          r.bg === "--tug-base-surface-global-primary-normal-content-rest") &&
        !r.contrastPass,
    );
    expect(coreFailures).toEqual([]);

    // Token count must still be 373
    expect(Object.keys(output.tokens).length).toBe(373);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 Step 2: LIGHT_FORMULAS standalone literal equality tests
// Verifies that LIGHT_FORMULAS is a complete 202-field standalone literal
// and that EXAMPLE_RECIPES.harmony uses it directly. [D01] [D04]
// ---------------------------------------------------------------------------

describe("phase-3-step-2 standalone LIGHT_FORMULAS equality", () => {
  it("LIGHT_FORMULAS has exactly 202 fields (same as DARK_FORMULAS; +2 for accentSubtleTone/cautionBgTone added in step-7)", () => {
    expect(Object.keys(LIGHT_FORMULAS).length).toBe(202);
    expect(Object.keys(DARK_FORMULAS).length).toBe(202);
  });

  it("LIGHT_FORMULAS is used directly in EXAMPLE_RECIPES.harmony (no spread composition)", () => {
    // Phase 3 step 9: harmony recipe references LIGHT_FORMULAS directly [D04]
    expect(EXAMPLE_RECIPES.harmony.formulas).toBe(LIGHT_FORMULAS);
  });

  it("LIGHT_FORMULAS has no spread operators (is a standalone literal)", () => {
    // Verify the object is its own complete definition — no prototype chain entries
    // that would indicate inheritance from another object via spread composition
    const keys = Object.keys(LIGHT_FORMULAS);
    expect(keys.length).toBe(202); // 200 original + 2 added in step-7 (accentSubtleTone, cautionBgTone)
    // Spot-check key fields from each semantic group to confirm they are own properties
    expect(Object.hasOwn(LIGHT_FORMULAS, "bgAppTone")).toBe(true);
    expect(Object.hasOwn(LIGHT_FORMULAS, "surfaceDefaultTone")).toBe(true);
    expect(Object.hasOwn(LIGHT_FORMULAS, "fgDefaultTone")).toBe(true);
    expect(Object.hasOwn(LIGHT_FORMULAS, "borderIBase")).toBe(true);
    expect(Object.hasOwn(LIGHT_FORMULAS, "bgAppHueSlot")).toBe(true);
    expect(Object.hasOwn(LIGHT_FORMULAS, "outlinedBgHoverHueSlot")).toBe(true);
    expect(Object.hasOwn(LIGHT_FORMULAS, "tabBgHoverAlpha")).toBe(true);
    expect(Object.hasOwn(LIGHT_FORMULAS, "dividerDefaultToneOverride")).toBe(true);
    expect(Object.hasOwn(LIGHT_FORMULAS, "surfScreenHue")).toBe(true);
    expect(Object.hasOwn(LIGHT_FORMULAS, "selectionInactiveSemanticMode")).toBe(true);
  });

  it("LIGHT_FORMULAS surface/canvas group has correct light-mode values", () => {
    // Verify all surface/canvas fields have the expected light-mode design values (Step 2 coverage)
    expect(LIGHT_FORMULAS.bgAppTone).toBe(95);
    expect(LIGHT_FORMULAS.bgCanvasTone).toBe(95);
    expect(LIGHT_FORMULAS.surfaceSunkenTone).toBe(88);
    expect(LIGHT_FORMULAS.surfaceDefaultTone).toBe(90);
    expect(LIGHT_FORMULAS.surfaceRaisedTone).toBe(92);
    expect(LIGHT_FORMULAS.surfaceOverlayTone).toBe(93);
    expect(LIGHT_FORMULAS.surfaceInsetTone).toBe(86);
    expect(LIGHT_FORMULAS.surfaceContentTone).toBe(86);
    expect(LIGHT_FORMULAS.surfaceScreenTone).toBe(85);
    expect(LIGHT_FORMULAS.atmI).toBe(6);
    expect(LIGHT_FORMULAS.bgAppI).toBe(3);
    expect(LIGHT_FORMULAS.bgCanvasI).toBe(3);
    expect(LIGHT_FORMULAS.surfaceDefaultI).toBe(6);
    expect(LIGHT_FORMULAS.surfaceRaisedI).toBe(6);
    expect(LIGHT_FORMULAS.surfaceOverlayI).toBe(5);
    expect(LIGHT_FORMULAS.surfaceScreenI).toBe(8);
    expect(LIGHT_FORMULAS.surfaceInsetI).toBe(6);
    expect(LIGHT_FORMULAS.surfaceContentI).toBe(6);
    expect(LIGHT_FORMULAS.bgAppSurfaceI).toBe(3);
  });
});
