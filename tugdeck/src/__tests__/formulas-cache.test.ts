/**
 * formulas-cache tests — Step 2: formulasCache and GET /__themes/formulas endpoint.
 *
 * Tests call handleFormulasGet directly with mock cache values.
 * No running Vite server needed.
 *
 * Tests cover:
 * - handleFormulasGet returns 404 when cache is null
 * - handleFormulasGet returns 200 with correct JSON shape when cache is populated
 * - Response includes formulas, mode, and themeName fields per Spec S03
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";

import { handleFormulasGet, type FormulasCache } from "../../vite.config";

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("handleFormulasGet", () => {
  it("TC1: returns 404 when cache is null", () => {
    const result = handleFormulasGet(null);
    expect(result.status).toBe(404);
    const body = JSON.parse(result.body) as { error: string };
    expect(typeof body.error).toBe("string");
  });

  it("TC2: returns 200 with correct shape when cache is populated", () => {
    const mockCache: FormulasCache = {
      formulas: { surfaceCanvasTone: 8, surfaceAppIntensity: 3 },
      mode: "dark",
      themeName: "my-theme",
    };
    const result = handleFormulasGet(mockCache);
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { formulas: unknown; mode: string; themeName: string };
    expect(body.mode).toBe("dark");
    expect(body.themeName).toBe("my-theme");
    expect(typeof body.formulas).toBe("object");
  });

  it("TC3: response body includes all formulas fields", () => {
    const mockCache: FormulasCache = {
      formulas: {
        surfaceCanvasTone: 8,
        surfaceAppIntensity: 3,
        roleIntensity: 50,
        selectionInactiveSemanticMode: true,
        mutedTextHueExpression: "barePrimary",
      },
      mode: "light",
      themeName: "bright-theme",
    };
    const result = handleFormulasGet(mockCache);
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { formulas: Record<string, unknown>; mode: string; themeName: string };
    expect(body.mode).toBe("light");
    expect(body.themeName).toBe("bright-theme");
    expect(body.formulas["surfaceCanvasTone"]).toBe(8);
    expect(body.formulas["surfaceAppIntensity"]).toBe(3);
    expect(body.formulas["roleIntensity"]).toBe(50);
    expect(body.formulas["selectionInactiveSemanticMode"]).toBe(true);
    expect(body.formulas["mutedTextHueExpression"]).toBe("barePrimary");
  });
});
