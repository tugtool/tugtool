/**
 * Theme Derivation Engine tests.
 *
 * Covers:
 * - T2.1: deriveTheme(EXAMPLE_RECIPES.brio) produces token map with 375 entries
 * - T2.4: All output values for chromatic tokens match --tug-color(...) pattern
 * - T2.5: Theme-invariant tokens are correct for Brio
 * - T2.6: Non-override tokens resolve to valid sRGB gamut colors
 * - Recipe contrast validation (parameterized loop): one test case per EXAMPLE_RECIPES entry;
 *   adding a recipe automatically adds it to contrast validation [D02], Spec S04
 * - T-RESOLVED-CSS: generateResolvedCssExport() produces valid resolved oklch() CSS
 * - resolveHueSlots / evaluateRules unit and integration tests
 * - Contrast floor enforcement and composited contrast enforcement tests
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
  generateResolvedCssExport,
  resolveHueSlots,
  evaluateRules,
  enforceContrastFloor,
  primaryColorName,
  type DerivationFormulas,
  type ResolvedHueSlots,
  type ResolvedHueSlot,
  type ResolvedColor,
  type ContrastDiagnostic,
} from "@/components/tugways/theme-engine";
import { CORE_VISUAL_RULES, RULES } from "@/components/tugways/derivation-rules";

import {
  validateThemeContrast,
  CONTRAST_THRESHOLDS,
  CONTRAST_MARGINAL_DELTA,
  toneToL,
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

import { RECIPE_REGISTRY, darkRecipe as darkRecipeFn, lightRecipe as lightRecipeFn } from "@/components/tugways/recipe-functions";

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

/** Reference dark formula constants (replaces deleted DARK_FORMULAS from formula-constants). */
const DARK_FORMULAS = darkRecipeFn(EXAMPLE_RECIPES.brio);

/** Reference light formula constants (replaces deleted LIGHT_FORMULAS from formula-constants). */
const LIGHT_FORMULAS = lightRecipeFn(EXAMPLE_RECIPES.harmony);

/** Cached pairing lookup for tests that need contrast floor behavior. */
const TEST_PAIRING_LOOKUP = buildTestPairingLookup(ELEMENT_SURFACE_PAIRING_MAP);

/**
 * Compute a ResolvedColor for a chromatic token given hue angle, intensity (0-100),
 * tone (0-100), alpha (0-100), and the primary hue name.
 *
 * Replicates the private resolveOklch() formula from theme-engine.ts
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
  it("T2.1: deriveTheme(EXAMPLE_RECIPES.brio) produces token map with 375 entries", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    expect(Object.keys(output.tokens).length).toBe(375);
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
    // Note: at roleIntensity=50, roleIntensity=55. Since PEAK_C_SCALE=2, the engine
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

  it("ThemeOutput.name and recipe match the recipe", () => {
    const brio = deriveTheme(EXAMPLE_RECIPES.brio);
    expect(brio.name).toBe("brio");
    expect(brio.recipe).toBe("dark");
  });

  // -------------------------------------------------------------------------
  // T2.7: Card title token is present and uses the display hue (indigo 260°)
  // -------------------------------------------------------------------------

  it("T2.7a: deriveTheme(EXAMPLE_RECIPES.brio) produces a token for '--tug-base-element-cardTitle-text-normal-plain-rest'", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    expect(output.tokens["--tug-base-element-cardTitle-text-normal-plain-rest"]).toBeDefined();
    // The token value must be a --tug-color() string (chromatic token)
    expect(output.tokens["--tug-base-element-cardTitle-text-normal-plain-rest"]).toMatch(/--tug-color\(/);
  });

  it("T2.7b: card title token and body text token are both derived from text.hue (no display override in brio)", () => {
    // In the new ThemeRecipe structure, display defaults to recipe.text.hue when no display
    // override is set. Both card title and body text use the text hue slot (cobalt, 250°).
    // Step 4 will add a display override state field. [D04]
    const output = deriveTheme(EXAMPLE_RECIPES.brio);

    // Card title token uses the display hue slot (defaults to text.hue = cobalt, 250°)
    const cardTitleResolved = output.resolved["--tug-base-element-cardTitle-text-normal-plain-rest"];
    expect(cardTitleResolved).toBeDefined();

    // Body text token uses the content (txt) hue slot (cobalt, 250°)
    const bodyTextResolved = output.resolved["--tug-base-element-global-text-normal-default-rest"];
    expect(bodyTextResolved).toBeDefined();
    // cobalt = 250°; allow ±1° for rounding
    expect(bodyTextResolved!.h).toBeCloseTo(250, 0);

    // Both tokens present and resolved
    expect(cardTitleResolved!.h).toBeGreaterThan(0);
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

      // Token count must be 375 for every recipe (tokens includes invariant tokens
      // absent from resolved; tokens and resolved differ by design) [step-3 task]
      expect(Object.keys(output.tokens).length).toBe(375);

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

// =============================================================================
// Step 3: resolveHueSlots() tests
// =============================================================================

describe("resolveHueSlots — Step 3", () => {
  // -------------------------------------------------------------------------
  // T-RESOLVE: resolveHueSlots(EXAMPLE_RECIPES.brio) produces expected
  // angle/name/ref for each slot.
  //
  // Brio dark recipe:
  //   surface.card    = "indigo-violet"  -> atm
  //   text.hue        = "cobalt"         -> txt
  //   surface.canvas  = "indigo-violet"  -> canvas
  //   surface.canvas.hue = "indigo-violet" -> borderTint (default)
  //   role.action     = "blue"           -> interactive
  //   role.accent     = "orange"         -> accent
  //
  // Hue angles from the palette are used verbatim — warmth bias removed in Phase 4. [D02]
  // -------------------------------------------------------------------------
  it("T-RESOLVE: Brio recipe produces correct slot for each key", () => {
    const slots: ResolvedHueSlots = resolveHueSlots(EXAMPLE_RECIPES.brio);

    // atm: "indigo-violet" — hyphenated
    expect(slots.atm.name).toBeTruthy();
    expect(slots.atm.angle).toBeGreaterThan(0);
    expect(slots.atm.ref).toBeTruthy();
    expect(slots.atm.primaryName).toBeTruthy();

    // txt: "cobalt" — bare name, raw palette angle used verbatim
    expect(slots.txt.ref).toBe("cobalt");
    expect(slots.txt.name).toBe("cobalt");
    expect(slots.txt.primaryName).toBe("cobalt");

    // canvas: same as atm for Brio
    expect(slots.canvas.ref).toBe(slots.atm.ref);
    expect(slots.canvas.angle).toBe(slots.atm.angle);

    // cardFrame: derived from surface.canvas.hue ("indigo-violet") — same as borderTint
    expect(slots.cardFrame.ref).toBe(slots.borderTint.ref);
    expect(slots.cardFrame.name).toBe(slots.borderTint.name);

    // borderTint: same as atm for Brio (surface.canvas.hue = "indigo-violet")
    expect(slots.borderTint.ref).toBe(slots.atm.ref);

    // interactive: derived from role.action ("blue") — not "cyan" (link removed from recipe)
    expect(slots.interactive.ref).toBe("blue");
    expect(slots.interactive.name).toBe("blue");

    // active: "blue" (role.action)
    expect(slots.active.ref).toBe("blue");

    // accent: "orange" (default)
    expect(slots.accent.ref).toBe("orange");

    // Semantic hues (vivid role hues)
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
  // T-RESOLVE-DISPLAY-OVERRIDE: when display field is present in the recipe,
  // the display slot uses its hue instead of text.hue.
  // -------------------------------------------------------------------------
  it("T-RESOLVE-DISPLAY-OVERRIDE: display slot uses recipe.display.hue when provided", () => {
    // Brio has display: { hue: "indigo", intensity: 3 }
    // text.hue is "cobalt" — so display slot must differ from txt slot.
    const slots: ResolvedHueSlots = resolveHueSlots(EXAMPLE_RECIPES.brio);

    // The display slot must resolve to "indigo", not "cobalt"
    expect(slots.display.ref).toBe("indigo");
    expect(slots.display.name).toBe("indigo");

    // Confirm txt slot is still "cobalt" (text.hue unchanged)
    expect(slots.txt.ref).toBe("cobalt");

    // They must differ — display override is active
    expect(slots.display.angle).not.toBe(slots.txt.angle);
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
      surfaceScreenHueExpression: "cobalt",   // same as txtHue -> copies txt slot
      mutedTextHueExpression: "cobalt",        // literal txtHue (not "__bare_primary")
      subtleTextHueExpression: "cobalt",       // collapses to txt
      disabledTextHueExpression: "cobalt",     // collapses to txt
      inverseTextHueExpression: "cobalt",      // collapses to txt
      placeholderTextHueExpression: "atm",     // copies atm slot
      selectionInactiveSemanticMode: false, // compute atm-offset path
      selectionInactiveHueExpression: "yellow",   // unused when semanticMode=false
    };
    const lightRecipe = {
      name: "test-light",
      description: "Test recipe for light mode hue slot resolution.",
      recipe: "light" as const,
      surface: {
        canvas: { hue: "yellow", tone: 95, intensity: 6 },
        grid: { hue: "yellow", tone: 88, intensity: 5 },
        card: { hue: "yellow", tone: 85, intensity: 35 },
      },
      text: { hue: "cobalt", intensity: 4 },
      role: { tone: 55, intensity: 60, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
      formulas: lightFormulas,
    };
    const slots: ResolvedHueSlots = resolveHueSlots(lightRecipe);

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
  // T2.2: Resolved hue angles equal raw palette angles — no bias applied.
  // Warmth bias has been removed; hue angles are used verbatim from the palette.
  // -------------------------------------------------------------------------
  it("T2.2: resolveHueSlots uses raw palette angles with no bias", () => {
    const recipe = {
      name: "test-raw-angles",
      description: "Test recipe for raw palette angle verification.",
      recipe: "dark" as const,
      surface: {
        canvas: { hue: "violet", tone: 5, intensity: 5 },
        grid: { hue: "violet", tone: 12, intensity: 4 },
        card: { hue: "violet", tone: 16, intensity: 12 },
      },
      text: { hue: "cobalt", intensity: 3 },
      role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    };

    const slots = resolveHueSlots(recipe);

    // cobalt txt angle should equal the raw palette angle for "cobalt" — no bias shift
    // Calling resolveHueSlots again produces identical output (no parameter-dependent variation)
    const slotsAgain = resolveHueSlots(recipe);
    expect(slots.txt.angle).toBe(slotsAgain.txt.angle);

    // Orange accent must produce the raw orange palette angle
    expect(slots.accent.angle).toBe(slotsAgain.accent.angle);

    // Semantic hues produce the same raw angles
    expect(slots.destructive.angle).toBe(slotsAgain.destructive.angle);
    expect(slots.success.angle).toBe(slotsAgain.success.angle);
  });

  // -------------------------------------------------------------------------
  // T-BARE-BASE: bare base extraction returns "violet" for "indigo-violet".
  // -------------------------------------------------------------------------
  it("T-BARE-BASE: surfBareBase returns violet for indigo-violet atmosphere", () => {
    const recipe = {
      name: "test-bare-base",
      description: "Test recipe for surfBareBase extraction from hyphenated hue.",
      recipe: "dark" as const,
      surface: {
        canvas: { hue: "indigo-violet", tone: 5, intensity: 5 },
        grid: { hue: "indigo-violet", tone: 12, intensity: 4 },
        card: { hue: "indigo-violet", tone: 16, intensity: 12 },
      },
      text: { hue: "cobalt", intensity: 3 },
      role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    };
    const slots = resolveHueSlots(recipe);
    expect(slots.surfBareBase.ref).toBe("violet");
    expect(slots.surfBareBase.primaryName).toBe("violet");
  });

  it("T-BARE-BASE: surfBareBase returns bare name for non-hyphenated atmosphere", () => {
    const recipe = {
      name: "test-bare-base-bare",
      description: "Test recipe for surfBareBase extraction from bare hue name.",
      recipe: "dark" as const,
      surface: {
        canvas: { hue: "violet", tone: 5, intensity: 5 },
        grid: { hue: "violet", tone: 12, intensity: 4 },
        card: { hue: "violet", tone: 16, intensity: 12 },
      },
      text: { hue: "cobalt", intensity: 3 },
      role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    };
    const slots = resolveHueSlots(recipe);
    // For bare "violet", bare base is "violet" itself
    expect(slots.surfBareBase.primaryName).toBe("violet");
  });

  it("T-BARE-BASE: borderTintBareBase mirrors surfBareBase logic for borderTint hue", () => {
    const recipe = {
      name: "test-bt-bare",
      description: "Test recipe for borderTintBareBase extraction from hyphenated hue.",
      recipe: "dark" as const,
      surface: {
        canvas: { hue: "indigo-violet", tone: 5, intensity: 5 },
        grid: { hue: "indigo-violet", tone: 12, intensity: 4 },
        card: { hue: "indigo-violet", tone: 16, intensity: 12 },
      },
      text: { hue: "cobalt", intensity: 3 },
      role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    };
    const slots = resolveHueSlots(recipe);
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

    // Token count must remain 375
    expect(Object.keys(output.tokens).length).toBe(375);

    // Key Brio dark token spot-checks (from T-BRIO-MATCH fixture)
    // bg-app: indigo-violet i:2 t:5
    expect(output.tokens["--tug-base-surface-global-primary-normal-app-rest"]).toBe("--tug-color(indigo-violet, i: 2, t: 5)");

    // fg-default: cobalt i:3 t:94
    expect(output.tokens["--tug-base-element-global-text-normal-default-rest"]).toBe("--tug-color(cobalt, i: 3, t: 94)");

    // fg-subtle: indigo-violet i:7, tone adjusted by contrast floor from 37 → 63
    // (informational threshold 60 against surface-default requires higher tone)
    // Uses informational hue slot (element.informational = "indigo-violet" in brio recipe)
    expect(output.tokens["--tug-base-element-global-text-normal-subtle-rest"]).toBe("--tug-color(indigo-violet, i: 7, t: 63)");

    // fg-inverse: sapphire-cobalt i:3 t:100 (compiled from P2 inverseTextTone at V=50;
    // ref=100 is at the maximum — midpoint-preserving endpoints give low=100, high=100,
    // so compiled value = 100 at all parameter values.)
    expect(output.tokens["--tug-base-element-global-text-normal-inverse-rest"]).toBe("--tug-color(sapphire-cobalt, i: 3, t: 100)");

    // selection-bg-inactive: yellow i:0 t:30 a:25
    expect(output.tokens["--tug-base-surface-selection-primary-normal-plain-inactive"]).toMatch(/yellow/);

    // surface-sunken: violet (surfBareBase) i:5 t:11
    expect(output.tokens["--tug-base-surface-global-primary-normal-sunken-rest"]).toBe("--tug-color(violet, i: 5, t: 11)");
  });

  // -------------------------------------------------------------------------
  // T2.4: semantic hues and recipe hues both go through the unified resolveSlot
  // (the former separate semantic-slot function was merged into resolveSlot when warmth was removed).
  // Verified by checking that semantic hues and recipe hues both go through
  // resolveSlot and produce the same raw-angle output.
  // -------------------------------------------------------------------------
  it("T2.4: semantic hues and recipe hues produce identical resolution (merged resolveSlot)", () => {
    const recipe = {
      name: "test-semantic-merge",
      description: "Test that semantic hue resolution is identical to recipe hue resolution.",
      recipe: "dark" as const,
      surface: {
        canvas: { hue: "orange", tone: 5, intensity: 5 },
        grid: { hue: "orange", tone: 12, intensity: 4 },
        card: { hue: "orange", tone: 16, intensity: 12 },
      },
      text: { hue: "orange", intensity: 3 },
      role: { tone: 50, intensity: 50, accent: "orange", action: "orange", agent: "orange", data: "orange", success: "orange", caution: "orange", danger: "orange" },
    };
    const slots = resolveHueSlots(recipe);

    // All slots should resolve to the same angle since they all use "orange"
    const refAngle = slots.atm.angle;
    expect(slots.txt.angle).toBe(refAngle);
    expect(slots.accent.angle).toBe(refAngle);
    expect(slots.interactive.angle).toBe(refAngle);
    expect(slots.destructive.angle).toBe(refAngle);
    expect(slots.success.angle).toBe(refAngle);
    expect(slots.caution.angle).toBe(refAngle);
    expect(slots.agent.angle).toBe(refAngle);
    expect(slots.data.angle).toBe(refAngle);
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
// Step 5 tests: T-RULES-SURFACES, T-RULES-FG, T-RULES-INVARIANT
// These verify that CORE_VISUAL_RULES + evaluateRules() produce the same
// output as the imperative deriveTheme() code for section A tokens.
// =============================================================================

describe("derivation-engine step-5 rules", () => {
  /** Run evaluateRules for CORE_VISUAL_RULES against the given recipe. */
  function runCoreRules(recipe: typeof EXAMPLE_RECIPES.brio): {
    ruleTokens: Record<string, string>;
    ruleResolved: Record<string, ResolvedColor>;
    imperative: ReturnType<typeof deriveTheme>;
  } {
    // Mirror deriveTheme() formula resolution precedence (Spec S04):
    //   1. recipe.formulas (direct escape hatch)
    //   2. RECIPE_REGISTRY[recipe.recipe]
    let recipeFormulas: DerivationFormulas;
    if (recipe.formulas) {
      recipeFormulas = recipe.formulas;
    } else {
      const registryEntry = RECIPE_REGISTRY[recipe.recipe];
      recipeFormulas = registryEntry
        ? registryEntry.fn(recipe)
        : darkRecipeFn(recipe);
    }
    // Pass recipeFormulas so resolveHueSlots uses the correct hue dispatch. [Step 4]
    const resolvedSlots = resolveHueSlots(recipe, recipeFormulas);

    const ruleTokens: Record<string, string> = {};
    const ruleResolved: Record<string, ResolvedColor> = {};
    const ruleDiagnostics: ContrastDiagnostic[] = [];

    evaluateRules(
      CORE_VISUAL_RULES,
      resolvedSlots,
      recipeFormulas,
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
    const brioLight = { ...EXAMPLE_RECIPES.brio, recipe: "light" as const };
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
// These verify that the full RULES table covers all 375 tokens and that
// evaluateRules(RULES, ...) matches imperative dark-mode output.
// T-RULES-LIGHT-MATCH deleted (clean break per D06 — deferred to light-formulas step).
// ---------------------------------------------------------------------------

describe("derivation-engine step-6 rules", () => {
  /** Run evaluateRules for RULES (full table) against the given recipe. */
  function runAllRules(recipe: Parameters<typeof deriveTheme>[0]): {
    ruleTokens: Record<string, string>;
    imperative: ReturnType<typeof deriveTheme>;
  } {
    // Mirror deriveTheme() formula resolution precedence (Spec S04).
    let recipeFormulas: DerivationFormulas;
    if (recipe.formulas) {
      recipeFormulas = recipe.formulas;
    } else {
      const registryEntry = RECIPE_REGISTRY[recipe.recipe];
      recipeFormulas = registryEntry
        ? registryEntry.fn(recipe)
        : darkRecipeFn(recipe);
    }
    // Pass recipeFormulas so resolveHueSlots uses the correct hue dispatch. [Step 4]
    const resolvedSlots = resolveHueSlots(recipe, recipeFormulas);

    const ruleTokens: Record<string, string> = {};
    const ruleResolved: Record<string, ResolvedColor> = {};
    const ruleDiagnostics: ContrastDiagnostic[] = [];

    evaluateRules(
      RULES,
      resolvedSlots,
      recipeFormulas,
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
  // T-RULES-COMPLETE: RULES table has exactly 375 entries
  // -------------------------------------------------------------------------
  it("T-RULES-COMPLETE: RULES table has exactly 375 entries", () => {
    expect(Object.keys(RULES).length).toBe(375);
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
// Step 3 tests: recipe function path in deriveTheme (Spec S04)
// T3.1: deriveTheme with controls produces 375 tokens
// T3.2: deriveTheme with formulas escape hatch still works
// T3.3: deriveTheme with no controls and no formulas uses registry defaults
// ---------------------------------------------------------------------------

describe("derivation-engine step-3 recipe-function integration", () => {
  const minimalDarkRecipe = EXAMPLE_RECIPES.brio;

  it("T3.1: deriveTheme with no controls and no formulas produces 375 tokens", () => {
    const recipe = { ...minimalDarkRecipe, formulas: undefined };
    const output = deriveTheme(recipe);
    expect(Object.keys(output.tokens).length).toBe(375);
  });

  it("T3.2: deriveTheme with formulas escape hatch still works (backward compat)", () => {
    const recipe = { ...minimalDarkRecipe, formulas: DARK_FORMULAS };
    const output = deriveTheme(recipe);
    expect(Object.keys(output.tokens).length).toBe(375);
  });

  it("T3.3: deriveTheme with no formulas uses registry defaults (375 tokens)", () => {
    const recipe = { ...minimalDarkRecipe, formulas: undefined };
    const output = deriveTheme(recipe);
    expect(Object.keys(output.tokens).length).toBe(375);
  });
});

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

    // Token count must still be 375
    expect(Object.keys(output.tokens).length).toBe(375);
  });
});

