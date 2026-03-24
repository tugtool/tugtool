/**
 * formulas-cache tests — GET /__themes/formulas endpoint.
 *
 * Tests cover:
 * - When cache is null → 404
 * - When cache has data → 200 with correct shape
 * - sources are read from recipe file at request time (not cached in FormulasCache)
 */
import { describe, it, expect } from "bun:test";
import { handleFormulasGet, type FormulasCache } from "../../vite.config";

/** Minimal fs mock: returns the given content for any readFileSync call. */
function mockFs(content: string): { readFileSync: (p: string, enc: "utf-8") => string } {
  return {
    readFileSync: (_p: string, _enc: "utf-8") => content,
  };
}

/** fs mock that throws on readFileSync (simulates missing recipe file). */
function failingFs(): { readFileSync: (p: string, enc: "utf-8") => string } {
  return {
    readFileSync: (_p: string, _enc: "utf-8") => {
      throw new Error("File not found");
    },
  };
}

const TEST_RECIPES_DIR = "/test/recipes";

describe("handleFormulasGet", () => {
  it("returns 404 when cache is null", () => {
    const result = handleFormulasGet(null, TEST_RECIPES_DIR, mockFs(""));
    expect(result.status).toBe(404);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toBeDefined();
  });

  it("returns 200 with correct shape when cache has data", () => {
    const cache: FormulasCache = {
      formulas: {
        contentTextIntensity: 4,
        contentTextTone: 92,
        surfaceCanvasTone: 8,
        surfaceCanvasIntensity: 3,
      },
      mode: "dark",
      themeName: "brio",
    };

    const result = handleFormulasGet(cache, TEST_RECIPES_DIR, mockFs(""));
    expect(result.status).toBe(200);

    const body = JSON.parse(result.body) as {
      formulas: Record<string, number | string | boolean>;
      mode: string;
      themeName: string;
    };
    expect(body.formulas).toBeDefined();
    expect(body.mode).toBe("dark");
    expect(body.themeName).toBe("brio");
    expect(body.formulas.contentTextIntensity).toBe(4);
    expect(body.formulas.contentTextTone).toBe(92);
  });

  it("returns 200 with light mode data", () => {
    const cache: FormulasCache = {
      formulas: { contentTextIntensity: 5, contentTextTone: 10 },
      mode: "light",
      themeName: "harmony",
    };

    const result = handleFormulasGet(cache, TEST_RECIPES_DIR, mockFs(""));
    expect(result.status).toBe(200);

    const body = JSON.parse(result.body) as { mode: string; themeName: string };
    expect(body.mode).toBe("light");
    expect(body.themeName).toBe("harmony");
  });

  it("extracts sources from recipe file content at request time", () => {
    const cache: FormulasCache = {
      formulas: { mutedTextTone: 66, surfaceAppIntensity: 2 },
      mode: "dark",
      themeName: "brio",
    };

    // Minimal recipe file content with matching fields
    const recipeContent = `
  mutedTextTone: primaryTextTone - 28,
  surfaceAppIntensity: 2,
`;

    const result = handleFormulasGet(cache, TEST_RECIPES_DIR, mockFs(recipeContent));
    expect(result.status).toBe(200);

    const body = JSON.parse(result.body) as {
      formulas: Record<string, number>;
      sources: Record<string, string>;
      mode: string;
      themeName: string;
    };
    expect(body.sources).toBeDefined();
    expect(body.sources.mutedTextTone).toBe("primaryTextTone - 28");
    expect(body.sources.surfaceAppIntensity).toBe("2");
  });

  it("returns empty sources when recipe file is missing", () => {
    const cache: FormulasCache = {
      formulas: { contentTextTone: 92 },
      mode: "dark",
      themeName: "brio",
    };

    const result = handleFormulasGet(cache, TEST_RECIPES_DIR, failingFs());
    expect(result.status).toBe(200);

    const body = JSON.parse(result.body) as { sources: Record<string, string> };
    expect(body.sources).toBeDefined();
    expect(Object.keys(body.sources).length).toBe(0);
  });

  it("only includes sources for fields present in formulas", () => {
    const cache: FormulasCache = {
      formulas: { contentTextTone: 92 },
      mode: "dark",
      themeName: "brio",
    };

    // Recipe has extra fields not in formulas
    const recipeContent = `
  contentTextTone: 92,
  unknownField: 42,
`;

    const result = handleFormulasGet(cache, TEST_RECIPES_DIR, mockFs(recipeContent));
    expect(result.status).toBe(200);

    const body = JSON.parse(result.body) as { sources: Record<string, string> };
    expect(body.sources.contentTextTone).toBe("92");
    expect(body.sources.unknownField).toBeUndefined();
  });
});
