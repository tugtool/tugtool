/**
 * formula-write tests — Step 4: POST /__themes/formula write-back endpoint.
 *
 * Tests call handleFormulaPost directly with mock fs implementations and
 * mock recipe file content strings. No running Vite server needed.
 *
 * Tests cover:
 * - Expression property replacement: `surfaceCanvasTone: canvasTone,` -> `surfaceCanvasTone: 8,`
 * - Shorthand property replacement: `cardBodyTone,` -> `cardBodyTone: 8,`
 * - 400 when field not found in recipe file
 * - Hue slot string fields written as quoted strings
 * - 400 when cache is null (no active theme)
 * - 400 when field is a boolean
 * - 400 when field is not a valid formula field
 * - 200 success response shape
 * - couplingWarning included when old RHS is a bare identifier
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";
import path from "path";

import {
  handleFormulaPost,
  type FormulasCache,
  type FsWriteImpl,
  type FormulaWriteResponse,
} from "../../vite.config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_RECIPE_ROOT = "/fake/tugdeck";
const DARK_RECIPE_PATH = path.join(FAKE_RECIPE_ROOT, "src/components/tugways/recipes/dark.ts");
const LIGHT_RECIPE_PATH = path.join(FAKE_RECIPE_ROOT, "src/components/tugways/recipes/light.ts");

/** Minimal recipe content with expression and shorthand properties. */
const DARK_RECIPE_CONTENT = `export function darkRecipe(spec: ThemeSpec): DerivationFormulas {
  const canvasTone = spec.surface.canvas.tone;
  const cardBodyTone = spec.surface.card.tone;
  const cardBodyIntensity = spec.surface.card.intensity;

  return {
    surfaceAppTone: canvasTone,
    surfaceCanvasTone: canvasTone,
    surfaceAppIntensity: 2,
    cardBodyTone,
    cardBodyIntensity,
    surfaceAppHueSlot: "canvas",
    roleIntensity: Math.round(roleIntensity),
    selectionInactiveSemanticMode: true,
  };
}
`;

/** Minimal formulasCache for dark mode. */
function makeDarkCache(): FormulasCache {
  return {
    formulas: {
      surfaceAppTone: 5,
      surfaceCanvasTone: 5,
      surfaceAppIntensity: 2,
      cardBodyTone: 15,
      cardBodyIntensity: 3,
      surfaceAppHueSlot: "canvas",
      roleIntensity: 50,
      selectionInactiveSemanticMode: true,
    },
    mode: "dark",
    themeName: "brio",
  };
}

/** Create a mock FsWriteImpl that stores written file contents. */
function makeMockFs(initialContent: string, filePath: string): FsWriteImpl & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    readdirSync: (_p: string) => [],
    readFileSync: (p: string) => {
      if (p === filePath) return initialContent;
      return "";
    },
    existsSync: (_p: string) => true,
    writeFileSync: (p: string, data: string) => { written.set(p, data); },
    mkdirSync: () => {},
    written,
  };
}

// ---------------------------------------------------------------------------
// formula-write tests
// ---------------------------------------------------------------------------

describe("formula-write: handleFormulaPost", () => {
  // TC1: Expression property replacement
  it("TC1: replaces expression property surfaceCanvasTone: canvasTone, with surfaceCanvasTone: 8,", () => {
    const mockFs = makeMockFs(DARK_RECIPE_CONTENT, DARK_RECIPE_PATH);
    const cache = makeDarkCache();

    const result = handleFormulaPost(
      { field: "surfaceCanvasTone", value: 8 },
      cache,
      mockFs,
      FAKE_RECIPE_ROOT,
    );

    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as FormulaWriteResponse;
    expect(body.ok).toBe(true);
    expect(body.field).toBe("surfaceCanvasTone");
    expect(body.oldValue).toBe("canvasTone");
    expect(body.newValue).toBe("8");
    expect(body.file).toBe("src/components/tugways/recipes/dark.ts");

    // Verify the file was written with the new value
    const written = mockFs.written.get(DARK_RECIPE_PATH);
    expect(written).toBeDefined();
    expect(written).toContain("surfaceCanvasTone: 8,");
    // Old form should no longer appear for that property
    expect(written).not.toMatch(/surfaceCanvasTone:\s+canvasTone,/);
  });

  // TC2: Shorthand property replacement
  it("TC2: replaces shorthand property cardBodyTone, with cardBodyTone: 8,", () => {
    const mockFs = makeMockFs(DARK_RECIPE_CONTENT, DARK_RECIPE_PATH);
    const cache = makeDarkCache();

    const result = handleFormulaPost(
      { field: "cardBodyTone", value: 8 },
      cache,
      mockFs,
      FAKE_RECIPE_ROOT,
    );

    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as FormulaWriteResponse;
    expect(body.ok).toBe(true);
    expect(body.field).toBe("cardBodyTone");
    expect(body.oldValue).toBe("cardBodyTone");
    expect(body.newValue).toBe("8");

    const written = mockFs.written.get(DARK_RECIPE_PATH);
    expect(written).toBeDefined();
    expect(written).toContain("cardBodyTone: 8,");
    // Bare shorthand form should no longer be present for this field
    expect(written).not.toMatch(/^\s+cardBodyTone,/m);
  });

  // TC3: 400 when field not found in recipe file
  it("TC3: returns 400 when field name is not found in the recipe file", () => {
    const mockFs = makeMockFs(DARK_RECIPE_CONTENT, DARK_RECIPE_PATH);
    const cache: FormulasCache = {
      ...makeDarkCache(),
      formulas: { ...makeDarkCache().formulas, nonExistentField: 99 },
    };

    const result = handleFormulaPost(
      { field: "nonExistentField", value: 5 },
      cache,
      mockFs,
      FAKE_RECIPE_ROOT,
    );

    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("not found");
    // No write should have occurred
    expect(mockFs.written.size).toBe(0);
  });

  // TC4: Hue slot string fields written as quoted strings
  it("TC4: writes hue slot string fields as quoted string values", () => {
    const mockFs = makeMockFs(DARK_RECIPE_CONTENT, DARK_RECIPE_PATH);
    const cache = makeDarkCache();

    const result = handleFormulaPost(
      { field: "surfaceAppHueSlot", value: "frame" },
      cache,
      mockFs,
      FAKE_RECIPE_ROOT,
    );

    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as FormulaWriteResponse;
    expect(body.ok).toBe(true);
    expect(body.newValue).toBe('"frame"');

    const written = mockFs.written.get(DARK_RECIPE_PATH);
    expect(written).toBeDefined();
    expect(written).toContain('surfaceAppHueSlot: "frame",');
  });

  // TC5: 400 when cache is null
  it("TC5: returns 400 when cache is null (no active theme)", () => {
    const mockFs = makeMockFs(DARK_RECIPE_CONTENT, DARK_RECIPE_PATH);

    const result = handleFormulaPost(
      { field: "surfaceCanvasTone", value: 8 },
      null,
      mockFs,
      FAKE_RECIPE_ROOT,
    );

    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain("no active theme");
    expect(mockFs.written.size).toBe(0);
  });

  // TC6: 400 when field is a boolean
  it("TC6: returns 400 when field is a boolean (selectionInactiveSemanticMode)", () => {
    const mockFs = makeMockFs(DARK_RECIPE_CONTENT, DARK_RECIPE_PATH);
    const cache = makeDarkCache();

    const result = handleFormulaPost(
      { field: "selectionInactiveSemanticMode", value: 1 },
      cache,
      mockFs,
      FAKE_RECIPE_ROOT,
    );

    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain("boolean");
    expect(mockFs.written.size).toBe(0);
  });

  // TC7: 400 when field is not a valid formula field
  it("TC7: returns 400 when field name is not a valid formula field (not in cache)", () => {
    const mockFs = makeMockFs(DARK_RECIPE_CONTENT, DARK_RECIPE_PATH);
    const cache = makeDarkCache();

    const result = handleFormulaPost(
      { field: "totallyFakeField", value: 42 },
      cache,
      mockFs,
      FAKE_RECIPE_ROOT,
    );

    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain("not a valid formula field");
    expect(mockFs.written.size).toBe(0);
  });

  // TC8: Success response shape matches Spec S04
  it("TC8: success response includes ok, file, field, oldValue, newValue", () => {
    const mockFs = makeMockFs(DARK_RECIPE_CONTENT, DARK_RECIPE_PATH);
    const cache = makeDarkCache();

    const result = handleFormulaPost(
      { field: "surfaceAppIntensity", value: 4 },
      cache,
      mockFs,
      FAKE_RECIPE_ROOT,
    );

    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as FormulaWriteResponse;
    expect(body.ok).toBe(true);
    expect(typeof body.file).toBe("string");
    expect(typeof body.field).toBe("string");
    expect(typeof body.oldValue).toBe("string");
    expect(typeof body.newValue).toBe("string");
    expect(body.oldValue).toBe("2");
    expect(body.newValue).toBe("4");
  });

  // TC9: couplingWarning when old RHS is a bare identifier shared by other fields
  it("TC9: includes couplingWarning when old RHS is a bare identifier used by other fields", () => {
    // Recipe where both surfaceAppTone and surfaceCanvasTone reference canvasTone
    const content = `export function darkRecipe(spec) {
  const canvasTone = spec.surface.canvas.tone;
  return {
    surfaceAppTone: canvasTone,
    surfaceCanvasTone: canvasTone,
    surfaceAppIntensity: 2,
  };
}
`;
    const mockFs = makeMockFs(content, DARK_RECIPE_PATH);
    const cache: FormulasCache = {
      formulas: {
        surfaceAppTone: 5,
        surfaceCanvasTone: 5,
        surfaceAppIntensity: 2,
      },
      mode: "dark",
      themeName: "brio",
    };

    const result = handleFormulaPost(
      { field: "surfaceCanvasTone", value: 8 },
      cache,
      mockFs,
      FAKE_RECIPE_ROOT,
    );

    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as FormulaWriteResponse;
    expect(body.ok).toBe(true);
    // surfaceAppTone also references canvasTone, so it should appear in couplingWarning
    expect(body.couplingWarning).toBeDefined();
    expect(body.couplingWarning).toContain("surfaceAppTone");
  });

  // TC10: light mode resolves to light recipe path
  it("TC10: resolves to light recipe path when mode is light", () => {
    const lightRecipeContent = `export function lightRecipe(spec) {
  return {
    surfaceCanvasTone: 95,
    surfaceAppHueSlot: "canvas",
  };
}
`;
    const mockFs: FsWriteImpl & { written: Map<string, string> } = {
      readdirSync: (_p: string) => [],
      readFileSync: (p: string) => {
        if (p === LIGHT_RECIPE_PATH) return lightRecipeContent;
        return "";
      },
      existsSync: (_p: string) => true,
      writeFileSync: (p: string, data: string) => { mockFs.written.set(p, data); },
      mkdirSync: () => {},
      written: new Map<string, string>(),
    };
    const cache: FormulasCache = {
      formulas: { surfaceCanvasTone: 95, surfaceAppHueSlot: "canvas" },
      mode: "light",
      themeName: "harmony",
    };

    const result = handleFormulaPost(
      { field: "surfaceCanvasTone", value: 90 },
      cache,
      mockFs,
      FAKE_RECIPE_ROOT,
    );

    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as FormulaWriteResponse;
    expect(body.file).toBe("src/components/tugways/recipes/light.ts");
    expect(mockFs.written.has(LIGHT_RECIPE_PATH)).toBe(true);
  });

  // TC11: 400 when request body is null
  it("TC11: returns 400 when request body is null", () => {
    const mockFs = makeMockFs(DARK_RECIPE_CONTENT, DARK_RECIPE_PATH);

    const result = handleFormulaPost(null, makeDarkCache(), mockFs, FAKE_RECIPE_ROOT);

    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(typeof body.error).toBe("string");
  });

  // TC12: 400 when field is missing from request body
  it("TC12: returns 400 when field is missing from request body", () => {
    const mockFs = makeMockFs(DARK_RECIPE_CONTENT, DARK_RECIPE_PATH);

    const result = handleFormulaPost(
      { value: 8 },
      makeDarkCache(),
      mockFs,
      FAKE_RECIPE_ROOT,
    );

    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain("field");
  });
});
