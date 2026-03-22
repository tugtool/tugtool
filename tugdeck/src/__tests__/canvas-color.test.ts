/**
 * canvas-color.ts tests — runtime canvas color derivation from ThemeRecipe.
 *
 * Verifies that:
 * - canvasColorHex() with derived params matches the former CANVAS_COLORS lookup
 *   for brio and harmony (regression parity: brio I:2 T:5, harmony I:3 T:95)
 * - canvasColorHex() with params derived from an authored recipe returns a valid hex
 *
 * [D08] Canvas color derived from theme JSON at runtime, Spec S04.
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";

import { canvasColorHex } from "@/canvas-color";
import { deriveTheme, type ThemeRecipe } from "@/components/tugways/theme-engine";

import brioJson from "../../themes/brio.json";
import harmonyJson from "../../themes/harmony.json";

const brio = brioJson as ThemeRecipe;
const harmony = harmonyJson as ThemeRecipe;

// ---------------------------------------------------------------------------
// Helper: compute expected hex via the same algorithm as the former CANVAS_COLORS
// lookup, using the known DERIVED intensity values (not raw recipe values).
// brio:    dark recipe => surfaceCanvasIntensity = 2, surfaceCanvasTone = 5
// harmony: light recipe => surfaceCanvasIntensity = 3, surfaceCanvasTone = 95
// ---------------------------------------------------------------------------

describe("canvasColorHex", () => {
  it("TC1: brio derived params produce the same hex as former CANVAS_COLORS[brio]", () => {
    // The former CANVAS_COLORS table hardcoded brio as { hue: "indigo-violet", intensity: 2, tone: 5 }.
    // The DERIVED surfaceCanvasIntensity from darkRecipe is always 2 (not the raw recipe value of 5).
    // The DERIVED surfaceCanvasTone equals recipe.surface.canvas.tone = 5.
    const brioOutput = deriveTheme(brio);
    const params = {
      hue: brio.surface.canvas.hue,
      tone: brioOutput.formulas.surfaceCanvasTone,
      intensity: brioOutput.formulas.surfaceCanvasIntensity,
    };
    // Verify derived params match former hardcoded values.
    expect(params.hue).toBe("indigo-violet");
    expect(params.tone).toBe(5);
    expect(params.intensity).toBe(2);

    // Compare against the canonical expected result using the identical params
    // that the former CANVAS_COLORS table used. Both must produce the same hex.
    const expectedHex = canvasColorHex({ hue: "indigo-violet", tone: 5, intensity: 2 });
    const actualHex = canvasColorHex(params);
    expect(actualHex).toBe(expectedHex);
    // Verify it is a valid 6-digit hex string.
    expect(actualHex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("TC2: harmony derived params produce the same hex as former CANVAS_COLORS[harmony]", () => {
    // The former CANVAS_COLORS table hardcoded harmony as { hue: "indigo-violet", intensity: 3, tone: 95 }.
    // The DERIVED surfaceCanvasIntensity from lightRecipe is always 3 (not the raw recipe value of 6).
    // The DERIVED surfaceCanvasTone equals recipe.surface.canvas.tone = 95.
    const harmonyOutput = deriveTheme(harmony);
    const params = {
      hue: harmony.surface.canvas.hue,
      tone: harmonyOutput.formulas.surfaceCanvasTone,
      intensity: harmonyOutput.formulas.surfaceCanvasIntensity,
    };
    // Verify derived params match former hardcoded values.
    expect(params.hue).toBe("indigo-violet");
    expect(params.tone).toBe(95);
    expect(params.intensity).toBe(3);

    // Compare against the canonical expected result using the identical params
    // that the former CANVAS_COLORS table used. Both must produce the same hex.
    const expectedHex = canvasColorHex({ hue: "indigo-violet", tone: 95, intensity: 3 });
    const actualHex = canvasColorHex(params);
    expect(actualHex).toBe(expectedHex);
    // Verify it is a valid 6-digit hex string.
    expect(actualHex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("TC3: arbitrary authored theme produces a valid hex from deriveTheme() canvas params", () => {
    // An authored theme with custom surface canvas params.
    const authoredRecipe: ThemeRecipe = {
      name: "custom-test",
      description: "Test authored theme for canvas color derivation",
      recipe: "dark",
      surface: {
        canvas: { hue: "teal", tone: 8, intensity: 4 },
        grid:   { hue: "teal", tone: 14, intensity: 3 },
        frame:  { hue: "teal", tone: 18, intensity: 10 },
        card:   { hue: "teal", tone: 14, intensity: 4 },
      },
      text: { hue: "cyan", intensity: 3 },
      role: {
        tone: 50,
        intensity: 50,
        accent: "orange",
        action: "blue",
        agent: "violet",
        data: "teal",
        success: "green",
        caution: "yellow",
        danger: "red",
      },
    };

    const themeOutput = deriveTheme(authoredRecipe);
    const params = {
      hue: authoredRecipe.surface.canvas.hue,
      tone: themeOutput.formulas.surfaceCanvasTone,
      intensity: themeOutput.formulas.surfaceCanvasIntensity,
    };

    // surfaceCanvasTone should match the raw canvas tone for dark recipe.
    expect(params.tone).toBe(8);
    // surfaceCanvasIntensity is the DERIVED value (hardcoded to 2 in darkRecipe).
    expect(params.intensity).toBe(2);

    const hex = canvasColorHex(params);
    // Must be a valid 6-digit hex string.
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    // Must not be pitch black (the teal hue should contribute chroma).
    expect(hex).not.toBe("#000000");
  });
});
