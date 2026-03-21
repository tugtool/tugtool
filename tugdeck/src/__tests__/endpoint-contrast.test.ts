/**
 * Endpoint contrast verification — Step 8 of tugplan-recipe-authoring-ui.
 *
 * Parameterized test that iterates over all 7 parameters x 2 modes
 * (dark, light) x 2 extremes (value=0, value=100).
 *
 * For each combination:
 *   - Sets the target parameter to the extreme value (0 or 100).
 *   - Sets all other parameters to 50 (midpoint defaults).
 *   - Calls compileRecipe() to produce DerivationFormulas.
 *   - Calls deriveTheme() with the reference recipe (brio for dark, harmony
 *     for light) using those compiled formulas.
 *   - Runs validateThemeContrast() on the resolved output.
 *   - Asserts zero unexpected contrast failures (excluding decorative-role
 *     pairs and the documented global / recipe-specific exceptions).
 *
 * Covers:
 * - T8.1: All 7 parameters at value=0 pass contrast validation in dark mode.
 * - T8.2: All 7 parameters at value=0 pass contrast validation in light mode.
 * - T8.3: All 7 parameters at value=100 pass contrast validation in dark mode.
 * - T8.4: All 7 parameters at value=100 pass contrast validation in light mode.
 *
 * Run with: cd tugdeck && bun test -- endpoint-contrast
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";

import {
  compileRecipe,
  defaultParameters,
  type RecipeParameters,
} from "@/components/tugways/recipe-parameters";
import {
  deriveTheme,
  EXAMPLE_RECIPES,
} from "@/components/tugways/theme-derivation-engine";
import {
  validateThemeContrast,
} from "@/components/tugways/theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/element-surface-pairing-map";
import {
  KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS,
  KNOWN_PAIR_EXCEPTIONS,
  RECIPE_PAIR_EXCEPTIONS,
  ENDPOINT_CONSTRAINT_PAIR_EXCEPTIONS,
} from "./contrast-exceptions";

// ---------------------------------------------------------------------------
// Parameter list — all 7 keys of RecipeParameters
// ---------------------------------------------------------------------------

const PARAMETER_KEYS: Array<keyof RecipeParameters> = [
  "surfaceDepth",
  "textHierarchy",
  "controlWeight",
  "borderDefinition",
  "shadowDepth",
  "signalStrength",
  "atmosphere",
];

// ---------------------------------------------------------------------------
// Build a RecipeParameters with one parameter set to the extreme value and
// all others at 50.
// ---------------------------------------------------------------------------

function buildParams(target: keyof RecipeParameters, value: 0 | 100): RecipeParameters {
  return { ...defaultParameters(), [target]: value };
}

// ---------------------------------------------------------------------------
// Run contrast validation for one (parameter, mode, extreme) combination.
// Returns an array of unexpected failure descriptions (empty = pass).
// ---------------------------------------------------------------------------

function collectUnexpectedFailures(
  paramKey: keyof RecipeParameters,
  mode: "dark" | "light",
  extremeValue: 0 | 100,
): string[] {
  const params = buildParams(paramKey, extremeValue);
  const formulas = compileRecipe(mode, params);

  // Use the reference recipe for the mode (brio=dark, harmony=light) but
  // override formulas with those compiled from the extreme parameters. [D06]
  const baseRecipe = mode === "dark" ? EXAMPLE_RECIPES.brio : EXAMPLE_RECIPES.harmony;
  const recipe = { ...baseRecipe, formulas, parameters: undefined };

  const output = deriveTheme(recipe);
  const results = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);

  const recipeExceptions: ReadonlySet<string> =
    RECIPE_PAIR_EXCEPTIONS[baseRecipe.name] ?? new Set<string>();

  const failures: string[] = [];

  for (const r of results) {
    // Decorative pairs have no minimum — skip per plan spec.
    if (r.role === "decorative") continue;

    // Already passing — no issue.
    if (r.contrastPass) continue;

    // Check element-token-level exceptions.
    if (KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.has(r.fg)) continue;

    // Check pair-level global exceptions.
    const pairKey = `${r.fg}|${r.bg}`;
    if (KNOWN_PAIR_EXCEPTIONS.has(pairKey)) continue;

    // Check recipe-specific pair exceptions.
    if (recipeExceptions.has(pairKey)) continue;

    // Check endpoint-constraint exceptions (placeholder range issues; Plan 2).
    if (ENDPOINT_CONSTRAINT_PAIR_EXCEPTIONS.has(pairKey)) continue;

    failures.push(
      `[${paramKey}=${extremeValue} ${mode}] ${r.fg} | ${r.bg}: contrast=${r.contrast.toFixed(1)}, role=${r.role}`,
    );
  }

  return failures;
}

// ---------------------------------------------------------------------------
// T8.1: All 7 parameters at value=0 pass contrast validation in dark mode.
// ---------------------------------------------------------------------------

describe("endpoint-contrast: T8.1 — all 7 parameters at value=0, dark mode", () => {
  for (const paramKey of PARAMETER_KEYS) {
    it(`${paramKey}=0 in dark mode: zero unexpected contrast failures`, () => {
      const failures = collectUnexpectedFailures(paramKey, "dark", 0);
      expect(failures).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// T8.2: All 7 parameters at value=0 pass contrast validation in light mode.
// ---------------------------------------------------------------------------

describe("endpoint-contrast: T8.2 — all 7 parameters at value=0, light mode", () => {
  for (const paramKey of PARAMETER_KEYS) {
    it(`${paramKey}=0 in light mode: zero unexpected contrast failures`, () => {
      const failures = collectUnexpectedFailures(paramKey, "light", 0);
      expect(failures).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// T8.3: All 7 parameters at value=100 pass contrast validation in dark mode.
// ---------------------------------------------------------------------------

describe("endpoint-contrast: T8.3 — all 7 parameters at value=100, dark mode", () => {
  for (const paramKey of PARAMETER_KEYS) {
    it(`${paramKey}=100 in dark mode: zero unexpected contrast failures`, () => {
      const failures = collectUnexpectedFailures(paramKey, "dark", 100);
      expect(failures).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// T8.4: All 7 parameters at value=100 pass contrast validation in light mode.
// ---------------------------------------------------------------------------

describe("endpoint-contrast: T8.4 — all 7 parameters at value=100, light mode", () => {
  for (const paramKey of PARAMETER_KEYS) {
    it(`${paramKey}=100 in light mode: zero unexpected contrast failures`, () => {
      const failures = collectUnexpectedFailures(paramKey, "light", 100);
      expect(failures).toEqual([]);
    });
  }
});
