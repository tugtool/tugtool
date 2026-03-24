/**
 * formulas-cache tests — GET /__themes/formulas endpoint.
 *
 * Tests cover:
 * - When cache is null → 404
 * - When cache has data → 200 with correct shape
 */
import { describe, it, expect } from "bun:test";
import { handleFormulasGet, type FormulasCache } from "../../vite.config";

describe("handleFormulasGet", () => {
  it("returns 404 when cache is null", () => {
    const result = handleFormulasGet(null);
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
      sources: {},
      mode: "dark",
      themeName: "brio",
    };

    const result = handleFormulasGet(cache);
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
      sources: {},
      mode: "light",
      themeName: "harmony",
    };

    const result = handleFormulasGet(cache);
    expect(result.status).toBe(200);

    const body = JSON.parse(result.body) as { mode: string; themeName: string };
    expect(body.mode).toBe("light");
    expect(body.themeName).toBe("harmony");
  });

  it("includes sources field in response when cache has sources", () => {
    const cache: FormulasCache = {
      formulas: { mutedTextTone: 66, surfaceAppIntensity: 2 },
      sources: {
        mutedTextTone: "primaryTextTone - 28",
        surfaceAppIntensity: "2",
      },
      mode: "dark",
      themeName: "brio",
    };

    const result = handleFormulasGet(cache);
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

  it("includes empty sources object when cache sources is empty", () => {
    const cache: FormulasCache = {
      formulas: { contentTextTone: 92 },
      sources: {},
      mode: "dark",
      themeName: "brio",
    };

    const result = handleFormulasGet(cache);
    expect(result.status).toBe(200);

    const body = JSON.parse(result.body) as { sources: Record<string, string> };
    expect(body.sources).toBeDefined();
    expect(Object.keys(body.sources).length).toBe(0);
  });
});
