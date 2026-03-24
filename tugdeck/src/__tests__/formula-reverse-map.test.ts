/**
 * formula-reverse-map tests.
 *
 * Tests cover:
 * - Unit test with mock chromatic rules (intensityExpr + toneExpr)
 * - Unit test with constant expression (lit() that takes no args)
 * - Unit test with mock shadow rule
 * - Unit test with mock structural rule (valueExpr)
 * - Unit test with formulas-mediated hue slot
 * - Integration test: buildReverseMap(RULES) with real RULES table
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";
import { buildReverseMap } from "@/components/tugways/formula-reverse-map";
import type { DerivationRule, DerivationFormulas } from "@/components/tugways/theme-engine";
import { RULES } from "@/components/tugways/theme-rules";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type F = DerivationFormulas;

/** Literal expression: always returns a constant without reading formulas. */
function lit(n: number): () => number {
  return () => n;
}

// ---------------------------------------------------------------------------
// Unit: chromatic rule with intensity and tone expressions
// ---------------------------------------------------------------------------

describe("buildReverseMap — chromatic rule", () => {
  it("captures intensityExpr and toneExpr field names", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-surface": {
        type: "chromatic",
        hueSlot: "canvas", // direct ResolvedHueSlots key — no hueSlot field
        intensityExpr: (f: F) => f.surfaceCanvasIntensity,
        toneExpr: (f: F) => f.surfaceCanvas, // computed tone field (not surfaceCanvasTone)
      },
    };

    const { fieldToTokens, tokenToFields } = buildReverseMap(rules);

    // fieldToTokens: intensity field
    expect(fieldToTokens.has("surfaceCanvasIntensity")).toBe(true);
    const intensityEntry = fieldToTokens.get("surfaceCanvasIntensity")!;
    expect(intensityEntry.length).toBeGreaterThan(0);
    expect(intensityEntry.some((e) => e.token === "--tug-test-surface" && e.property === "intensity")).toBe(true);

    // fieldToTokens: tone field (surfaceCanvas, the pre-computed tone field)
    expect(fieldToTokens.has("surfaceCanvas")).toBe(true);
    const toneEntry = fieldToTokens.get("surfaceCanvas")!;
    expect(toneEntry.some((e) => e.token === "--tug-test-surface" && e.property === "tone")).toBe(true);

    // tokenToFields
    const tokenEntry = tokenToFields.get("--tug-test-surface")!;
    expect(tokenEntry).toBeDefined();
    expect(tokenEntry.some((e) => e.field === "surfaceCanvasIntensity" && e.property === "intensity")).toBe(true);
    expect(tokenEntry.some((e) => e.field === "surfaceCanvas" && e.property === "tone")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit: constant expression (lit()) — no formula fields accessed
// ---------------------------------------------------------------------------

describe("buildReverseMap — constant expression", () => {
  it("produces empty mappings when expressions access no fields", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-constant": {
        type: "chromatic",
        hueSlot: "text", // direct key
        intensityExpr: lit(4),
        toneExpr: lit(90),
      },
    };

    const { fieldToTokens, tokenToFields } = buildReverseMap(rules);

    // No fields should be recorded since lit() takes no args from formulas
    const tokenEntry = tokenToFields.get("--tug-test-constant");
    // tokenEntry may be undefined or empty
    if (tokenEntry) {
      expect(tokenEntry.length).toBe(0);
    } else {
      expect(tokenEntry).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Unit: shadow rule — only alphaExpr
// ---------------------------------------------------------------------------

describe("buildReverseMap — shadow rule", () => {
  it("captures only alphaExpr field", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-shadow-md": {
        type: "shadow",
        alphaExpr: (f: F) => f.shadowMdAlpha,
      },
    };

    const { fieldToTokens, tokenToFields } = buildReverseMap(rules);

    expect(fieldToTokens.has("shadowMdAlpha")).toBe(true);
    const entry = fieldToTokens.get("shadowMdAlpha")!;
    expect(entry.some((e) => e.token === "--tug-shadow-md" && e.property === "alpha")).toBe(true);

    const tokenEntry = tokenToFields.get("--tug-shadow-md")!;
    expect(tokenEntry).toBeDefined();
    expect(tokenEntry.some((e) => e.field === "shadowMdAlpha" && e.property === "alpha")).toBe(true);

    // No intensity or tone entries
    expect(tokenEntry.some((e) => e.property === "intensity")).toBe(false);
    expect(tokenEntry.some((e) => e.property === "tone")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit: structural rule — valueExpr
// ---------------------------------------------------------------------------

describe("buildReverseMap — structural rule", () => {
  it("captures fields accessed by valueExpr", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-test-structural": {
        type: "structural",
        valueExpr: (f: F) => {
          const _x = f.contentTextTone;
          return `oklch(${_x} 0 0)`;
        },
      },
    };

    const { fieldToTokens, tokenToFields } = buildReverseMap(rules);

    expect(fieldToTokens.has("contentTextTone")).toBe(true);
    const entry = fieldToTokens.get("contentTextTone")!;
    expect(entry.some((e) => e.token === "--tug-test-structural")).toBe(true);

    const tokenEntry = tokenToFields.get("--tug-test-structural")!;
    expect(tokenEntry).toBeDefined();
    expect(tokenEntry.some((e) => e.field === "contentTextTone")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit: formulas-mediated hue slot
// ---------------------------------------------------------------------------

describe("buildReverseMap — formulas-mediated hue slot", () => {
  it("records HueSlot field for non-resolved, non-sentinel hue slots", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-surface-app": {
        type: "chromatic",
        hueSlot: "surfaceApp", // NOT in RESOLVED_HUE_SLOT_KEYS, NOT in SENTINEL_HUE_SLOTS
        intensityExpr: (f: F) => f.surfaceAppIntensity,
        toneExpr: (f: F) => f.surfaceAppTone,
      },
    };

    const { fieldToTokens, tokenToFields } = buildReverseMap(rules);

    // Should record "surfaceAppHueSlot" as a hueSlot-property field
    expect(fieldToTokens.has("surfaceAppHueSlot")).toBe(true);
    const hueEntry = fieldToTokens.get("surfaceAppHueSlot")!;
    expect(hueEntry.some((e) => e.token === "--tug-surface-app" && e.property === "hueSlot")).toBe(true);

    const tokenEntry = tokenToFields.get("--tug-surface-app")!;
    expect(tokenEntry.some((e) => e.field === "surfaceAppHueSlot" && e.property === "hueSlot")).toBe(true);
  });

  it("does NOT record HueSlot field for direct ResolvedHueSlots keys", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-surface-direct": {
        type: "chromatic",
        hueSlot: "canvas", // direct ResolvedHueSlots key
        intensityExpr: lit(5),
        toneExpr: lit(10),
      },
    };

    const { tokenToFields } = buildReverseMap(rules);

    // No hueSlot field should be recorded
    const tokenEntry = tokenToFields.get("--tug-surface-direct") ?? [];
    expect(tokenEntry.some((e) => e.property === "hueSlot")).toBe(false);
  });

  it("does NOT record HueSlot field for sentinel hue slots", () => {
    const rules: Record<string, DerivationRule> = {
      "--tug-surface-sentinel": {
        type: "chromatic",
        hueSlot: "highlight", // sentinel
        intensityExpr: lit(5),
        toneExpr: lit(50),
        alphaExpr: (f: F) => f.overlayHighlightAlpha,
      },
    };

    const { tokenToFields } = buildReverseMap(rules);

    // Should have alpha mapping but no hueSlot mapping
    const tokenEntry = tokenToFields.get("--tug-surface-sentinel") ?? [];
    expect(tokenEntry.some((e) => e.property === "hueSlot")).toBe(false);
    expect(tokenEntry.some((e) => e.property === "alpha")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: buildReverseMap with real RULES table
// ---------------------------------------------------------------------------

describe("buildReverseMap — integration with real RULES", () => {
  it("produces a non-empty map with valid DerivationFormulas field names", () => {
    const { fieldToTokens, tokenToFields } = buildReverseMap(RULES);

    // Non-empty
    expect(fieldToTokens.size).toBeGreaterThan(0);
    expect(tokenToFields.size).toBeGreaterThan(0);

    // All token names in the map should start with "--tug-"
    for (const tokenName of tokenToFields.keys()) {
      expect(tokenName.startsWith("--tug-")).toBe(true);
    }

    // Verify some known field names are present
    // Note: surfaceCanvas is the computed tone field (not surfaceCanvasTone)
    expect(fieldToTokens.has("contentTextIntensity")).toBe(true);
    expect(fieldToTokens.has("surfaceCanvas")).toBe(true);
    expect(fieldToTokens.has("shadowMdAlpha")).toBe(true);

    // All field names recorded should be plausible identifiers (camelCase strings)
    for (const fieldName of fieldToTokens.keys()) {
      expect(typeof fieldName).toBe("string");
      expect(fieldName.length).toBeGreaterThan(0);
      // Should not contain "--" (no token prefix leakage)
      expect(fieldName.includes("--")).toBe(false);
    }
  });

  it("fieldToTokens and tokenToFields are mutually consistent", () => {
    const { fieldToTokens, tokenToFields } = buildReverseMap(RULES);

    // Every field->token entry should have a corresponding token->field entry
    for (const [field, mappings] of fieldToTokens.entries()) {
      for (const { token } of mappings) {
        const tokenEntry = tokenToFields.get(token);
        expect(tokenEntry).toBeDefined();
        expect(tokenEntry!.some((e) => e.field === field)).toBe(true);
      }
    }
  });
});
