/**
 * formula-reverse-map tests — Proxy-based reverse map builder.
 *
 * Tests cover:
 * - Unit test with small mock RULES table: fieldToTokens for surface rule
 * - Unit test with lit() constant rule: tokenToFields is empty
 * - Unit test with mock ShadowRule: only alphaExpr field captured with "alpha"
 * - Unit test with mock StructuralRule referencing formula fields
 * - Unit test with formulas-mediated hue slot rule
 * - Integration test with real RULES table: map is non-empty, all field names valid
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";

import {
  buildReverseMap,
  type ReverseMap,
  type FormulaTokenMapping,
  type TokenFormulaMapping,
} from "@/components/tugways/formula-reverse-map";
import { RULES } from "@/components/tugways/theme-rules";
import type {
  DerivationFormulas,
  DerivationRule,
  ResolvedHueSlots,
  ChromaticRule,
  ShadowRule,
  HighlightRule,
  StructuralRule,
} from "@/components/tugways/theme-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock DerivationFormulas for test assertions */
function mockFormulas(overrides: Partial<DerivationFormulas> = {}): DerivationFormulas {
  return overrides as DerivationFormulas;
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("buildReverseMap", () => {
  it("TC1: surface rule with intensityExpr and toneExpr records both fields", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-surface-default-rest": {
        type: "chromatic",
        hueSlot: "canvas", // direct ResolvedHueSlots key — no mediation
        intensityExpr: (f) => f.surfaceAppIntensity,
        toneExpr: (f) => f.surfaceAppTone,
      } as ChromaticRule,
    };

    const map = buildReverseMap(rules);

    // fieldToTokens should have entries for both formula fields
    const intensityTokens = map.fieldToTokens.get("surfaceAppIntensity");
    expect(intensityTokens).toBeDefined();
    expect(intensityTokens!.length).toBeGreaterThan(0);
    expect(intensityTokens![0].token).toBe("--tug-test-surface-default-rest");
    expect(intensityTokens![0].property).toBe("intensity");

    const toneTokens = map.fieldToTokens.get("surfaceAppTone");
    expect(toneTokens).toBeDefined();
    expect(toneTokens!.length).toBeGreaterThan(0);
    expect(toneTokens![0].token).toBe("--tug-test-surface-default-rest");
    expect(toneTokens![0].property).toBe("tone");

    // tokenToFields for this token should have both entries
    const tokenFields = map.tokenToFields.get("--tug-test-surface-default-rest");
    expect(tokenFields).toBeDefined();
    const fieldNames = tokenFields!.map((m) => m.field);
    expect(fieldNames).toContain("surfaceAppIntensity");
    expect(fieldNames).toContain("surfaceAppTone");
  });

  it("TC2: lit() constant rule produces empty tokenToFields for that token", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-constant-token": {
        type: "chromatic",
        hueSlot: "action", // direct ResolvedHueSlots key
        intensityExpr: () => 50, // constant — no field access
        toneExpr: () => 50,      // constant — no field access
      } as ChromaticRule,
    };

    const map = buildReverseMap(rules);

    // Token should not appear in tokenToFields (no fields accessed)
    const tokenFields = map.tokenToFields.get("--tug-test-constant-token");
    expect(tokenFields).toBeUndefined();
  });

  it("TC3: ShadowRule records only the alphaExpr field with property 'alpha'", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-shadow-sm": {
        type: "shadow",
        alphaExpr: (f) => f.shadowMdAlpha,
      } as ShadowRule,
    };

    const map = buildReverseMap(rules);

    // Only shadowMdAlpha should appear
    const alphaTokens = map.fieldToTokens.get("shadowMdAlpha");
    expect(alphaTokens).toBeDefined();
    expect(alphaTokens![0].token).toBe("--tug-test-shadow-sm");
    expect(alphaTokens![0].property).toBe("alpha");

    // tokenToFields should have exactly one entry
    const tokenFields = map.tokenToFields.get("--tug-test-shadow-sm");
    expect(tokenFields).toBeDefined();
    expect(tokenFields!.length).toBe(1);
    expect(tokenFields![0].field).toBe("shadowMdAlpha");
    expect(tokenFields![0].property).toBe("alpha");
  });

  it("TC3b: HighlightRule records only the alphaExpr field with property 'alpha'", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-highlight-overlay": {
        type: "highlight",
        alphaExpr: (f) => f.overlayHighlightAlpha,
      } as HighlightRule,
    };

    const map = buildReverseMap(rules);

    const alphaTokens = map.fieldToTokens.get("overlayHighlightAlpha");
    expect(alphaTokens).toBeDefined();
    expect(alphaTokens![0].property).toBe("alpha");

    const tokenFields = map.tokenToFields.get("--tug-test-highlight-overlay");
    expect(tokenFields).toBeDefined();
    expect(tokenFields!.length).toBe(1);
    expect(tokenFields![0].field).toBe("overlayHighlightAlpha");
  });

  it("TC4: StructuralRule with valueExpr referencing formula fields appears in map", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-structural-token": {
        type: "structural",
        valueExpr: (f: DerivationFormulas, _resolvedSlots: ResolvedHueSlots): string => {
          // Access two formula fields
          const a = f.shadowXsAlpha;
          const b = f.contentTextTone;
          return `${a} ${b}`;
        },
      } as StructuralRule,
    };

    const map = buildReverseMap(rules);

    const tokenFields = map.tokenToFields.get("--tug-test-structural-token");
    expect(tokenFields).toBeDefined();
    const fieldNames = tokenFields!.map((m) => m.field);
    expect(fieldNames).toContain("shadowXsAlpha");
    expect(fieldNames).toContain("contentTextTone");
  });

  it("TC5: formulas-mediated hue slot rule records the HueSlot field with property 'hueSlot'", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-surface-app-rest": {
        type: "chromatic",
        hueSlot: "surfaceApp", // NOT in RESOLVED_HUE_SLOT_KEYS — formulas-mediated
        intensityExpr: () => 2,
        toneExpr: (f) => f.surfaceApp,
      } as ChromaticRule,
    };

    const map = buildReverseMap(rules);

    // Should record surfaceAppHueSlot with property "hueSlot"
    const hueSlotTokens = map.fieldToTokens.get("surfaceAppHueSlot");
    expect(hueSlotTokens).toBeDefined();
    expect(hueSlotTokens!.length).toBeGreaterThan(0);
    expect(hueSlotTokens![0].token).toBe("--tug-test-surface-app-rest");
    expect(hueSlotTokens![0].property).toBe("hueSlot");

    // tokenToFields should contain surfaceAppHueSlot
    const tokenFields = map.tokenToFields.get("--tug-test-surface-app-rest");
    expect(tokenFields).toBeDefined();
    const hueField = tokenFields!.find((m) => m.property === "hueSlot");
    expect(hueField).toBeDefined();
    expect(hueField!.field).toBe("surfaceAppHueSlot");
  });

  it("TC5b: sentinel hue slot (white) does not generate a hueSlot formula field", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-white-sentinel": {
        type: "chromatic",
        hueSlot: "white", // sentinel — should NOT be mediated
        intensityExpr: () => 0,
        toneExpr: () => 100,
      } as ChromaticRule,
    };

    const map = buildReverseMap(rules);

    // No whiteHueSlot field should be recorded
    const hueSlotTokens = map.fieldToTokens.get("whiteHueSlot");
    expect(hueSlotTokens).toBeUndefined();
  });

  it("TC5c: direct ResolvedHueSlots key (text) does not generate a hueSlot formula field", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-text-direct": {
        type: "chromatic",
        hueSlot: "text", // direct key — no mediation
        intensityExpr: (f) => f.contentTextIntensity,
        toneExpr: (f) => f.contentTextTone,
      } as ChromaticRule,
    };

    const map = buildReverseMap(rules);

    // No textHueSlot field should be recorded
    const hueSlotTokens = map.fieldToTokens.get("textHueSlot");
    expect(hueSlotTokens).toBeUndefined();
  });

  it("TC6: WhiteRule and InvariantRule produce no entries in the map", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-white": { type: "white" },
      "--tug-test-invariant": { type: "invariant", value: "transparent" },
    };

    const map = buildReverseMap(rules);

    expect(map.tokenToFields.size).toBe(0);
    expect(map.fieldToTokens.size).toBe(0);
  });

  it("TC7: ChromaticRule with alphaExpr records alpha field", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-surface-alpha": {
        type: "chromatic",
        hueSlot: "canvas", // direct key
        intensityExpr: () => 5,
        toneExpr: () => 10,
        alphaExpr: (f) => f.overlayDimAlpha,
      } as ChromaticRule,
    };

    const map = buildReverseMap(rules);

    const alphaTokens = map.fieldToTokens.get("overlayDimAlpha");
    expect(alphaTokens).toBeDefined();
    expect(alphaTokens![0].property).toBe("alpha");
  });

  it("TC8: expression that throws is skipped without crashing", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-throwing-expr": {
        type: "chromatic",
        hueSlot: "canvas", // direct key
        intensityExpr: () => { throw new Error("oops"); },
        toneExpr: (f) => f.surfaceAppTone,
      } as ChromaticRule,
    };

    // Should not throw — throwing expr is caught
    let map: ReverseMap;
    expect(() => {
      map = buildReverseMap(rules);
    }).not.toThrow();

    // The tone field should still be captured from toneExpr
    const toneTokens = map!.fieldToTokens.get("surfaceAppTone");
    expect(toneTokens).toBeDefined();
    // The intensity field from the throwing expr is NOT in the map
    const tokenFields = map!.tokenToFields.get("--tug-test-throwing-expr");
    expect(tokenFields).toBeDefined();
    const properties = tokenFields!.map((m) => m.property);
    // Only "tone" from toneExpr (intensityExpr threw)
    expect(properties).toContain("tone");
    expect(properties).not.toContain("intensity");
  });
});

// ---------------------------------------------------------------------------
// Integration test with real RULES table
// ---------------------------------------------------------------------------

describe("buildReverseMap integration", () => {
  it("TC9: real RULES table produces a non-empty map with valid DerivationFormulas field names", () => {
    const map = buildReverseMap(RULES);

    // The map must be non-empty
    expect(map.fieldToTokens.size).toBeGreaterThan(0);
    expect(map.tokenToFields.size).toBeGreaterThan(0);

    // Spot-check: common formula fields must appear in fieldToTokens.
    // Note: these are the computed/pre-processed formula fields used directly in
    // RULES expressions (e.g. formulas.surfaceApp, not formulas.surfaceAppTone —
    // the latter is a recipe input that the recipe function computes into surfaceApp).
    const expectedFields = [
      "surfaceApp",              // computed surface tone used by surface() rule builder
      "surfaceAppBaseIntensity", // intensity for app background surface
      "contentTextTone",         // used directly in foreground rules
      "contentTextIntensity",    // used directly in foreground rules
      "shadowMdAlpha",           // shadow alpha field
      "roleIntensity",           // role intensity field (used in borderRamp, filledBg, etc.)
    ];
    for (const field of expectedFields) {
      expect(map.fieldToTokens.has(field)).toBe(true);
    }

    // Spot-check: hueSlot mediated fields must appear
    expect(map.fieldToTokens.has("surfaceAppHueSlot")).toBe(true);
    expect(map.fieldToTokens.has("surfaceCanvasHueSlot")).toBe(true);
  });

  it("TC10: all field names in fieldToTokens are valid keyof DerivationFormulas", () => {
    // Build the map with real RULES
    const map = buildReverseMap(RULES);

    // Derive the actual set of DerivationFormulas keys by running deriveTheme
    // on a minimal spec to get a formulas object, then check its keys.
    // We use a minimal approach: check the keys against a freshly derived theme.
    // Import is done here to keep the test self-contained.
    const { deriveTheme } = require("@/components/tugways/theme-engine");
    const brioJson = require("../../themes/brio.json");

    const themeOutput = deriveTheme(brioJson);
    const validFormulaKeys = new Set(Object.keys(themeOutput.formulas));

    const invalidFields: string[] = [];
    for (const field of map.fieldToTokens.keys()) {
      if (!validFormulaKeys.has(field)) {
        invalidFields.push(field);
      }
    }

    if (invalidFields.length > 0) {
      console.error("Invalid formula fields found in reverse map:", invalidFields);
    }
    expect(invalidFields).toHaveLength(0);
  });
});
