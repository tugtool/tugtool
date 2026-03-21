/**
 * Recipe Parameters tests — Step 1 of tugplan-recipe-parameter-engine.
 *
 * Covers:
 * - T1.1: compileRecipe("dark", defaultParameters()) returns valid DerivationFormulas
 * - T1.2: compileRecipe("light", defaultParameters()) returns valid DerivationFormulas
 * - T1.3: At parameter=0 and parameter=100, all fields are within valid ranges
 * - T1.4: compileRecipe with mixed parameters (some at 0, some at 100) produces valid formulas
 * - T1.5: Structural fields in compiled output match the mode template
 *
 * Run with: cd tugdeck && bun test src/__tests__/recipe-parameters.test.ts
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";

import {
  compileRecipe,
  defaultParameters,
  getParameterFields,
  DARK_STRUCTURAL_TEMPLATE,
  LIGHT_STRUCTURAL_TEMPLATE,
  DARK_ENDPOINTS,
  LIGHT_ENDPOINTS,
  type RecipeParameters,
} from "@/components/tugways/recipe-parameters";
import {
  type DerivationFormulas,
  DARK_FORMULAS,
  LIGHT_FORMULAS,
} from "@/components/tugways/theme-derivation-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check that a compiled DerivationFormulas has all required fields populated.
 * Returns an array of missing or undefined field names.
 */
function findMissingFields(formulas: DerivationFormulas): string[] {
  const required: Array<keyof DerivationFormulas> = [
    // Canvas Darkness
    "surfaceAppTone",
    "surfaceCanvasTone",
    // Surface Layering
    "surfaceSunkenTone",
    "surfaceDefaultTone",
    "surfaceRaisedTone",
    "surfaceOverlayTone",
    "surfaceInsetTone",
    "surfaceContentTone",
    "surfaceScreenTone",
    // Surface Coloring
    "atmosphereIntensity",
    "surfaceAppIntensity",
    "surfaceCanvasIntensity",
    "surfaceDefaultIntensity",
    "surfaceRaisedIntensity",
    "surfaceOverlayIntensity",
    "surfaceScreenIntensity",
    "surfaceInsetIntensity",
    "surfaceContentIntensity",
    "surfaceAppBaseIntensity",
    // Text Brightness
    "contentTextTone",
    "inverseTextTone",
    // Text Hierarchy
    "mutedTextTone",
    "subtleTextTone",
    "disabledTextTone",
    "placeholderTextTone",
    // Text Coloring
    "contentTextIntensity",
    "subtleTextIntensity",
    "mutedTextIntensity",
    "atmosphereBorderIntensity",
    "inverseTextIntensity",
    "onCautionTextIntensity",
    "onSuccessTextIntensity",
    // Border Visibility
    "borderBaseIntensity",
    "borderStrongIntensity",
    "borderMutedTone",
    "borderMutedIntensity",
    "borderStrongTone",
    "dividerDefaultIntensity",
    "dividerMutedIntensity",
    "borderSignalTone",
    "semanticSignalTone",
    "accentSubtleTone",
    "cautionSurfaceTone",
    // Card Frame Style
    "cardFrameActiveIntensity",
    "cardFrameActiveTone",
    "cardFrameInactiveIntensity",
    "cardFrameInactiveTone",
    // Shadow Depth
    "shadowXsAlpha",
    "shadowMdAlpha",
    "shadowLgAlpha",
    "shadowXlAlpha",
    "shadowOverlayAlpha",
    "overlayDimAlpha",
    "overlayScrimAlpha",
    "overlayHighlightAlpha",
    // Filled Control
    "filledSurfaceRestTone",
    "filledSurfaceHoverTone",
    "filledSurfaceActiveTone",
    // Outlined Control
    "outlinedTextRestTone",
    "outlinedTextHoverTone",
    "outlinedTextActiveTone",
    "outlinedTextIntensity",
    "outlinedIconRestTone",
    "outlinedIconHoverTone",
    "outlinedIconActiveTone",
    "outlinedIconIntensity",
    "outlinedTextRestToneLight",
    "outlinedTextHoverToneLight",
    "outlinedTextActiveToneLight",
    "outlinedIconRestToneLight",
    "outlinedIconHoverToneLight",
    "outlinedIconActiveToneLight",
    "outlinedOptionBorderRestTone",
    "outlinedOptionBorderHoverTone",
    "outlinedOptionBorderActiveTone",
    "outlinedSurfaceHoverIntensity",
    "outlinedSurfaceHoverAlpha",
    "outlinedSurfaceActiveIntensity",
    "outlinedSurfaceActiveAlpha",
    // Ghost Control
    "ghostTextRestTone",
    "ghostTextHoverTone",
    "ghostTextActiveTone",
    "ghostTextRestIntensity",
    "ghostTextHoverIntensity",
    "ghostTextActiveIntensity",
    "ghostIconRestTone",
    "ghostIconHoverTone",
    "ghostIconActiveTone",
    "ghostIconRestIntensity",
    "ghostIconHoverIntensity",
    "ghostIconActiveIntensity",
    "ghostBorderIntensity",
    "ghostBorderTone",
    "ghostTextRestToneLight",
    "ghostTextHoverToneLight",
    "ghostTextActiveToneLight",
    "ghostTextRestIntensityLight",
    "ghostTextHoverIntensityLight",
    "ghostTextActiveIntensityLight",
    "ghostIconRestToneLight",
    "ghostIconHoverToneLight",
    "ghostIconActiveToneLight",
    "ghostIconActiveIntensityLight",
    // Badge Style
    "badgeTintedTextIntensity",
    "badgeTintedTextTone",
    "badgeTintedSurfaceIntensity",
    "badgeTintedSurfaceTone",
    "badgeTintedSurfaceAlpha",
    "badgeTintedBorderIntensity",
    "badgeTintedBorderTone",
    "badgeTintedBorderAlpha",
    // Icon Style
    "iconActiveTone",
    "iconMutedIntensity",
    "iconMutedTone",
    // Tab Style
    "tabTextActiveTone",
    // Toggle Style
    "toggleTrackOnHoverTone",
    "toggleThumbDisabledTone",
    "toggleTrackDisabledIntensity",
    // Field Style
    "fieldSurfaceRestTone",
    "fieldSurfaceHoverTone",
    "fieldSurfaceFocusTone",
    "fieldSurfaceDisabledTone",
    "fieldSurfaceReadOnlyTone",
    "fieldSurfaceRestIntensity",
    "disabledSurfaceIntensity",
    "disabledBorderIntensity",
    // Hue Slot Dispatch
    "surfaceAppHueSlot",
    "surfaceCanvasHueSlot",
    "surfaceSunkenHueSlot",
    "surfaceDefaultHueSlot",
    "surfaceRaisedHueSlot",
    "surfaceOverlayHueSlot",
    "surfaceInsetHueSlot",
    "surfaceContentHueSlot",
    "surfaceScreenHueSlot",
    "mutedTextHueSlot",
    "subtleTextHueSlot",
    "disabledTextHueSlot",
    "placeholderTextHueSlot",
    "inverseTextHueSlot",
    "onAccentTextHueSlot",
    "iconMutedHueSlot",
    "iconOnAccentHueSlot",
    "dividerMutedHueSlot",
    "disabledSurfaceHueSlot",
    "fieldSurfaceHoverHueSlot",
    "fieldSurfaceReadOnlyHueSlot",
    "fieldPlaceholderHueSlot",
    "fieldBorderRestHueSlot",
    "fieldBorderHoverHueSlot",
    "toggleTrackDisabledHueSlot",
    "toggleThumbHueSlot",
    "checkmarkHueSlot",
    "radioDotHueSlot",
    "tabSurfaceActiveHueSlot",
    "tabSurfaceInactiveHueSlot",
    // Sentinel Hue Dispatch
    "outlinedSurfaceHoverHueSlot",
    "outlinedSurfaceActiveHueSlot",
    "ghostActionSurfaceHoverHueSlot",
    "ghostActionSurfaceActiveHueSlot",
    "ghostOptionSurfaceHoverHueSlot",
    "ghostOptionSurfaceActiveHueSlot",
    "tabSurfaceHoverHueSlot",
    "tabCloseSurfaceHoverHueSlot",
    "highlightHoverHueSlot",
    // Sentinel Alpha
    "tabSurfaceHoverAlpha",
    "tabCloseSurfaceHoverAlpha",
    "ghostActionSurfaceHoverAlpha",
    "ghostActionSurfaceActiveAlpha",
    "ghostOptionSurfaceHoverAlpha",
    "ghostOptionSurfaceActiveAlpha",
    "highlightHoverAlpha",
    "ghostDangerSurfaceHoverAlpha",
    "ghostDangerSurfaceActiveAlpha",
    // Computed Tone Override
    "dividerDefaultToneOverride",
    "dividerMutedToneOverride",
    "disabledTextToneComputed",
    "disabledBorderToneOverride",
    "outlinedSurfaceRestToneOverride",
    "outlinedSurfaceHoverToneOverride",
    "outlinedSurfaceActiveToneOverride",
    "toggleTrackOffToneOverride",
    "toggleDisabledToneOverride",
    "surfaceCanvasToneBase",
    "surfaceCanvasToneCenter",
    "surfaceCanvasToneScale",
    "disabledSurfaceToneBase",
    "disabledSurfaceToneScale",
    "borderStrongToneComputed",
    // Hue Name Dispatch
    "surfaceScreenHueExpression",
    "mutedTextHueExpression",
    "subtleTextHueExpression",
    "disabledTextHueExpression",
    "inverseTextHueExpression",
    "placeholderTextHueExpression",
    "selectionInactiveHueExpression",
    // Selection Mode
    "selectionInactiveSemanticMode",
    "selectionSurfaceInactiveIntensity",
    "selectionSurfaceInactiveTone",
    "selectionSurfaceInactiveAlpha",
    // Signal Intensity Value
    "signalIntensityValue",
  ];

  const missing: string[] = [];
  for (const field of required) {
    const value = (formulas as Record<string, unknown>)[field];
    if (value === undefined) {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * Check that all numeric fields in DerivationFormulas are within [0, 100].
 * String and boolean fields are skipped. Returns an array of out-of-range descriptions.
 */
function findOutOfRangeFields(formulas: DerivationFormulas): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(formulas as Record<string, unknown>)) {
    if (typeof value === "number") {
      if (value < 0 || value > 100) {
        out.push(`${key}: ${value}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// T1.1: compileRecipe("dark", defaultParameters()) returns valid DerivationFormulas
// ---------------------------------------------------------------------------

describe("recipe-parameters", () => {
  it("T1.1: compileRecipe('dark', defaultParameters()) returns a valid DerivationFormulas with all fields populated", () => {
    const formulas = compileRecipe("dark", defaultParameters());

    // Must be an object
    expect(formulas).toBeDefined();
    expect(typeof formulas).toBe("object");

    // All required fields must be present
    const missing = findMissingFields(formulas);
    expect(missing).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T1.2: compileRecipe("light", defaultParameters()) returns valid DerivationFormulas
  // ---------------------------------------------------------------------------

  it("T1.2: compileRecipe('light', defaultParameters()) returns a valid DerivationFormulas", () => {
    const formulas = compileRecipe("light", defaultParameters());

    expect(formulas).toBeDefined();
    expect(typeof formulas).toBe("object");

    const missing = findMissingFields(formulas);
    expect(missing).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T1.3: At parameter=0 and parameter=100, all numeric fields are within [0, 100]
  // ---------------------------------------------------------------------------

  it("T1.3: compileRecipe at parameter=0 for all parameters — all fields within [0, 100]", () => {
    const allZero: RecipeParameters = {
      surfaceDepth: 0,
      textHierarchy: 0,
      controlWeight: 0,
      borderDefinition: 0,
      shadowDepth: 0,
      signalStrength: 0,
      atmosphere: 0,
    };

    const darkFormulas = compileRecipe("dark", allZero);
    const lightFormulas = compileRecipe("light", allZero);

    const darkOut = findOutOfRangeFields(darkFormulas);
    const lightOut = findOutOfRangeFields(lightFormulas);

    expect(darkOut).toEqual([]);
    expect(lightOut).toEqual([]);
  });

  it("T1.3: compileRecipe at parameter=100 for all parameters — all fields within [0, 100]", () => {
    const allMax: RecipeParameters = {
      surfaceDepth: 100,
      textHierarchy: 100,
      controlWeight: 100,
      borderDefinition: 100,
      shadowDepth: 100,
      signalStrength: 100,
      atmosphere: 100,
    };

    const darkFormulas = compileRecipe("dark", allMax);
    const lightFormulas = compileRecipe("light", allMax);

    const darkOut = findOutOfRangeFields(darkFormulas);
    const lightOut = findOutOfRangeFields(lightFormulas);

    expect(darkOut).toEqual([]);
    expect(lightOut).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T1.4: compileRecipe with mixed parameters (some at 0, some at 100) produces valid formulas
  // ---------------------------------------------------------------------------

  it("T1.4: compileRecipe with mixed parameters produces valid DerivationFormulas", () => {
    const mixed: RecipeParameters = {
      surfaceDepth: 0,
      textHierarchy: 100,
      controlWeight: 0,
      borderDefinition: 100,
      shadowDepth: 0,
      signalStrength: 100,
      atmosphere: 0,
    };

    const darkFormulas = compileRecipe("dark", mixed);
    const lightFormulas = compileRecipe("light", mixed);

    // All fields populated
    expect(findMissingFields(darkFormulas)).toEqual([]);
    expect(findMissingFields(lightFormulas)).toEqual([]);

    // All numeric fields in range
    expect(findOutOfRangeFields(darkFormulas)).toEqual([]);
    expect(findOutOfRangeFields(lightFormulas)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T1.5: Structural fields in compiled output match the mode template
  // ---------------------------------------------------------------------------

  it("T1.5: compiled dark formulas have structural hue-slot-dispatch fields from DARK_STRUCTURAL_TEMPLATE", () => {
    const formulas = compileRecipe("dark", defaultParameters());

    // Verify key structural fields match the template
    for (const [key, value] of Object.entries(DARK_STRUCTURAL_TEMPLATE)) {
      const compiled = (formulas as Record<string, unknown>)[key];
      expect(compiled).toBe(value);
    }
  });

  it("T1.5: compiled light formulas have structural hue-slot-dispatch fields from LIGHT_STRUCTURAL_TEMPLATE", () => {
    const formulas = compileRecipe("light", defaultParameters());

    for (const [key, value] of Object.entries(LIGHT_STRUCTURAL_TEMPLATE)) {
      const compiled = (formulas as Record<string, unknown>)[key];
      expect(compiled).toBe(value);
    }
  });

  it("T1.5: dark template and light template differ in mode-specific fields (selectionInactiveSemanticMode)", () => {
    // Dark mode uses semantic mode (true); light uses atm-offset path (false)
    expect(DARK_STRUCTURAL_TEMPLATE.selectionInactiveSemanticMode).toBe(true);
    expect(LIGHT_STRUCTURAL_TEMPLATE.selectionInactiveSemanticMode).toBe(false);

    const darkFormulas = compileRecipe("dark", defaultParameters());
    const lightFormulas = compileRecipe("light", defaultParameters());
    expect(darkFormulas.selectionInactiveSemanticMode).toBe(true);
    expect(lightFormulas.selectionInactiveSemanticMode).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Neutralization overrides: surfaceCanvasToneScale = 0, disabledSurfaceToneScale = 0
  // per [D04]
  // ---------------------------------------------------------------------------

  it("surfaceCanvasToneScale is always 0 in compiled formulas (neutralizes computeTones scaling)", () => {
    expect(compileRecipe("dark", defaultParameters()).surfaceCanvasToneScale).toBe(0);
    expect(compileRecipe("light", defaultParameters()).surfaceCanvasToneScale).toBe(0);
    expect(
      compileRecipe("dark", { surfaceDepth: 0, textHierarchy: 0, controlWeight: 0, borderDefinition: 0, shadowDepth: 0, signalStrength: 0, atmosphere: 0 }).surfaceCanvasToneScale,
    ).toBe(0);
    expect(
      compileRecipe("dark", { surfaceDepth: 100, textHierarchy: 100, controlWeight: 100, borderDefinition: 100, shadowDepth: 100, signalStrength: 100, atmosphere: 100 }).surfaceCanvasToneScale,
    ).toBe(0);
  });

  it("disabledSurfaceToneScale is always 0 in compiled formulas (neutralizes computeTones scaling)", () => {
    expect(compileRecipe("dark", defaultParameters()).disabledSurfaceToneScale).toBe(0);
    expect(compileRecipe("light", defaultParameters()).disabledSurfaceToneScale).toBe(0);
  });

  it("surfaceCanvasToneCenter is always 50 in compiled formulas", () => {
    expect(compileRecipe("dark", defaultParameters()).surfaceCanvasToneCenter).toBe(50);
    expect(compileRecipe("light", defaultParameters()).surfaceCanvasToneCenter).toBe(50);
  });

  // ---------------------------------------------------------------------------
  // signalIntensityValue is set from P6 interpolation
  // ---------------------------------------------------------------------------

  it("signalIntensityValue at signalStrength=0 is 0 (fully muted)", () => {
    const p: RecipeParameters = {
      surfaceDepth: 50,
      textHierarchy: 50,
      controlWeight: 50,
      borderDefinition: 50,
      shadowDepth: 50,
      signalStrength: 0,
      atmosphere: 50,
    };
    expect(compileRecipe("dark", p).signalIntensityValue).toBe(0);
    expect(compileRecipe("light", p).signalIntensityValue).toBe(0);
  });

  it("signalIntensityValue at signalStrength=100 is 100 (fully vivid)", () => {
    const p: RecipeParameters = {
      surfaceDepth: 50,
      textHierarchy: 50,
      controlWeight: 50,
      borderDefinition: 50,
      shadowDepth: 50,
      signalStrength: 100,
      atmosphere: 50,
    };
    expect(compileRecipe("dark", p).signalIntensityValue).toBe(100);
    expect(compileRecipe("light", p).signalIntensityValue).toBe(100);
  });

  it("signalIntensityValue at signalStrength=50 is 50 (midpoint)", () => {
    expect(compileRecipe("dark", defaultParameters()).signalIntensityValue).toBe(50);
    expect(compileRecipe("light", defaultParameters()).signalIntensityValue).toBe(50);
  });

  // ---------------------------------------------------------------------------
  // defaultParameters() returns all-50 values
  // ---------------------------------------------------------------------------

  it("defaultParameters() returns all 7 fields set to 50", () => {
    const params = defaultParameters();
    expect(params.surfaceDepth).toBe(50);
    expect(params.textHierarchy).toBe(50);
    expect(params.controlWeight).toBe(50);
    expect(params.borderDefinition).toBe(50);
    expect(params.shadowDepth).toBe(50);
    expect(params.signalStrength).toBe(50);
    expect(params.atmosphere).toBe(50);
  });

  // ---------------------------------------------------------------------------
  // T2.1: getParameterFields("surfaceDepth", "dark") matches DARK_ENDPOINTS keys
  // ---------------------------------------------------------------------------

  it("T2.1: getParameterFields('surfaceDepth', 'dark') returns fields matching Object.keys(DARK_ENDPOINTS.surfaceDepth.low)", () => {
    const fields = getParameterFields("surfaceDepth", "dark");
    const expected = Object.keys(DARK_ENDPOINTS.surfaceDepth.low).sort();
    expect(fields).toEqual(expected);
  });

  // ---------------------------------------------------------------------------
  // T2.2: getParameterFields("controlWeight", "light") matches LIGHT_P3_ENDPOINTS keys
  // ---------------------------------------------------------------------------

  it("T2.2: getParameterFields('controlWeight', 'light') returns fields matching LIGHT_ENDPOINTS.controlWeight.low keys", () => {
    const fields = getParameterFields("controlWeight", "light");
    const expected = Object.keys(LIGHT_ENDPOINTS.controlWeight.low).sort();
    expect(fields).toEqual(expected);
  });

  // ---------------------------------------------------------------------------
  // T2.3: All 7 parameters x 2 modes return non-empty field lists
  // ---------------------------------------------------------------------------

  it("T2.3: all 7 parameters x 2 modes return non-empty sorted field lists", () => {
    const paramKeys: Array<keyof RecipeParameters> = [
      "surfaceDepth",
      "textHierarchy",
      "controlWeight",
      "borderDefinition",
      "shadowDepth",
      "signalStrength",
      "atmosphere",
    ];
    const modes: Array<"dark" | "light"> = ["dark", "light"];

    for (const paramKey of paramKeys) {
      for (const mode of modes) {
        const fields = getParameterFields(paramKey, mode);
        expect(fields.length).toBeGreaterThan(0);
        // Verify sorted order
        const sorted = [...fields].sort();
        expect(fields).toEqual(sorted);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // T7.1: Midpoint constraint — compileRecipe(mode, defaultParameters()) reproduces
  // the reference DARK_FORMULAS / LIGHT_FORMULAS numeric fields at V=50.
  // This verifies that endpoint refinements did not break the midpoint invariant.
  // ---------------------------------------------------------------------------

  it("T7.1: compileRecipe('dark', defaultParameters()) — all numeric fields match DARK_FORMULAS reference values", () => {
    const compiled = compileRecipe("dark", defaultParameters());

    // Fields intentionally neutralized by compileRecipe() per [D04]:
    // surfaceCanvasToneScale: forced to 0 (DARK_FORMULAS has 8) to eliminate
    //   the surfaceContrast-scaling path in computeTones().
    const neutralizedFields = new Set(["surfaceCanvasToneScale"]);

    // Collect all numeric fields from DARK_FORMULAS that are controlled by
    // the parameter endpoint system (i.e. all numeric fields).
    const mismatches: string[] = [];
    for (const [key, refValue] of Object.entries(DARK_FORMULAS as Record<string, unknown>)) {
      if (typeof refValue !== "number") continue;
      if (neutralizedFields.has(key)) continue; // intentional override
      const compiledValue = (compiled as Record<string, unknown>)[key];
      if (typeof compiledValue !== "number") {
        mismatches.push(`${key}: expected ${refValue} but got ${String(compiledValue)}`);
        continue;
      }
      // Allow floating-point tolerance of ±0.01 to account for rounding
      if (Math.abs(compiledValue - refValue) > 0.01) {
        mismatches.push(`${key}: expected ${refValue} but got ${compiledValue}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("T7.1: compileRecipe('light', defaultParameters()) — all numeric fields match LIGHT_FORMULAS reference values", () => {
    const compiled = compileRecipe("light", defaultParameters());

    // Fields intentionally neutralized by compileRecipe() per [D04].
    const neutralizedFields = new Set(["surfaceCanvasToneScale"]);

    const mismatches: string[] = [];
    for (const [key, refValue] of Object.entries(LIGHT_FORMULAS as Record<string, unknown>)) {
      if (typeof refValue !== "number") continue;
      if (neutralizedFields.has(key)) continue;
      const compiledValue = (compiled as Record<string, unknown>)[key];
      if (typeof compiledValue !== "number") {
        mismatches.push(`${key}: expected ${refValue} but got ${String(compiledValue)}`);
        continue;
      }
      if (Math.abs(compiledValue - refValue) > 0.01) {
        mismatches.push(`${key}: expected ${refValue} but got ${compiledValue}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T7.2: compileRecipe() at all-0 and all-100 produces valid DerivationFormulas.
  // No NaN values, no out-of-range numeric fields, and all required fields present.
  // ---------------------------------------------------------------------------

  it("T7.2: compileRecipe at all-0 — no NaN values in output", () => {
    const allZero: RecipeParameters = {
      surfaceDepth: 0,
      textHierarchy: 0,
      controlWeight: 0,
      borderDefinition: 0,
      shadowDepth: 0,
      signalStrength: 0,
      atmosphere: 0,
    };

    for (const mode of ["dark", "light"] as const) {
      const compiled = compileRecipe(mode, allZero);
      const nanFields: string[] = [];
      for (const [key, value] of Object.entries(compiled as Record<string, unknown>)) {
        if (typeof value === "number" && isNaN(value)) {
          nanFields.push(key);
        }
      }
      expect(nanFields).toEqual([]);

      // All required numeric fields in [0, 100]
      const outOfRange = findOutOfRangeFields(compiled as DerivationFormulas);
      expect(outOfRange).toEqual([]);

      // All required fields present
      const missing = findMissingFields(compiled as DerivationFormulas);
      expect(missing).toEqual([]);
    }
  });

  it("T7.2: compileRecipe at all-100 — no NaN values in output", () => {
    const allMax: RecipeParameters = {
      surfaceDepth: 100,
      textHierarchy: 100,
      controlWeight: 100,
      borderDefinition: 100,
      shadowDepth: 100,
      signalStrength: 100,
      atmosphere: 100,
    };

    for (const mode of ["dark", "light"] as const) {
      const compiled = compileRecipe(mode, allMax);
      const nanFields: string[] = [];
      for (const [key, value] of Object.entries(compiled as Record<string, unknown>)) {
        if (typeof value === "number" && isNaN(value)) {
          nanFields.push(key);
        }
      }
      expect(nanFields).toEqual([]);

      // All required numeric fields in [0, 100]
      const outOfRange = findOutOfRangeFields(compiled as DerivationFormulas);
      expect(outOfRange).toEqual([]);

      // All required fields present
      const missing = findMissingFields(compiled as DerivationFormulas);
      expect(missing).toEqual([]);
    }
  });

  it("T7.2: intermediate parameter values (25 and 75) produce smooth interpolation — no out-of-range fields", () => {
    const paramKeys: Array<keyof RecipeParameters> = [
      "surfaceDepth",
      "textHierarchy",
      "controlWeight",
      "borderDefinition",
      "shadowDepth",
      "signalStrength",
      "atmosphere",
    ];

    for (const paramKey of paramKeys) {
      for (const testValue of [25, 75]) {
        const params: RecipeParameters = {
          surfaceDepth: 50,
          textHierarchy: 50,
          controlWeight: 50,
          borderDefinition: 50,
          shadowDepth: 50,
          signalStrength: 50,
          atmosphere: 50,
        };
        params[paramKey] = testValue;

        for (const mode of ["dark", "light"] as const) {
          const compiled = compileRecipe(mode, params);
          const outOfRange = findOutOfRangeFields(compiled as DerivationFormulas);
          expect(outOfRange).toEqual([]);
        }
      }
    }
  });
});
