/**
 * Unit tests for findAndEditNumericLiteral and handleFormulaEdit
 * from vite.config.ts.
 *
 * Tests cover all expression forms present in recipe files:
 *   - Bare literal
 *   - Variable + offset (additive)
 *   - Variable - offset (subtractive)
 *   - Shorthand property reference (non-editable)
 *   - Math.max/Math.min clamped with arithmetic offset
 *   - Math.max/Math.min clamped with bare variable (non-editable)
 *   - Math.round with expression
 *   - Math.round of bare variable (non-editable)
 *   - Bare variable reference (non-editable)
 *   - Spec path reference (non-editable)
 *   - Field not found (returns null)
 *
 * handleFormulaEdit tests use a mocked FsWriteImpl so no real disk I/O occurs.
 */
import { describe, it, expect } from "bun:test";
import path from "path";

import {
  findAndEditNumericLiteral,
  handleFormulaEdit,
  type FsWriteImpl,
  type FormulasCache,
} from "../../vite.config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap a field assignment in a minimal recipe file body. */
function makeRecipe(line: string): string {
  return `export function darkRecipe(spec) {\n  return {\n    ${line}\n  };\n}\n`;
}

// ---------------------------------------------------------------------------
// findAndEditNumericLiteral tests
// ---------------------------------------------------------------------------

describe("findAndEditNumericLiteral", () => {
  // -------------------------------------------------------------------------
  // Bare literal: surfaceAppIntensity: 2,
  // -------------------------------------------------------------------------
  it("bare literal: replaces the literal value", () => {
    const content = makeRecipe("surfaceAppIntensity: 2,");
    const result = findAndEditNumericLiteral(content, "surfaceAppIntensity", 5);
    expect(result).not.toBeNull();
    expect(result).toContain("surfaceAppIntensity: 5,");
    expect(result).not.toContain("surfaceAppIntensity: 2,");
  });

  // -------------------------------------------------------------------------
  // Variable - offset: mutedTextTone: primaryTextTone - 28,
  // -------------------------------------------------------------------------
  it("variable minus offset: replaces the numeric offset", () => {
    const content = makeRecipe("mutedTextTone: primaryTextTone - 28,");
    const result = findAndEditNumericLiteral(content, "mutedTextTone", 30);
    expect(result).not.toBeNull();
    expect(result).toContain("mutedTextTone: primaryTextTone - 30,");
    expect(result).not.toContain("primaryTextTone - 28");
  });

  // -------------------------------------------------------------------------
  // Variable + offset: surfaceSunkenTone: canvasTone + 6,
  // -------------------------------------------------------------------------
  it("variable plus offset: replaces the numeric offset", () => {
    const content = makeRecipe("surfaceSunkenTone: canvasTone + 6,");
    const result = findAndEditNumericLiteral(content, "surfaceSunkenTone", 8);
    expect(result).not.toBeNull();
    expect(result).toContain("surfaceSunkenTone: canvasTone + 8,");
    expect(result).not.toContain("canvasTone + 6");
  });

  // -------------------------------------------------------------------------
  // Shorthand property reference: cardBodyTone,
  // No colon — not matched by field pattern → returns null.
  // -------------------------------------------------------------------------
  it("shorthand property reference: returns null (no colon, no match)", () => {
    const content = makeRecipe("cardBodyTone,");
    const result = findAndEditNumericLiteral(content, "cardBodyTone", 42);
    // Shorthand `cardBodyTone,` has no `: ` separator — field pattern won't match.
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Math.max/Math.min clamped with offset:
  //   filledSurfaceHoverTone: Math.max(0, Math.min(100, spec.role.tone - 5)),
  // -------------------------------------------------------------------------
  it("clamped with arithmetic offset: replaces inner offset literal", () => {
    const content = makeRecipe("filledSurfaceHoverTone: Math.max(0, Math.min(100, spec.role.tone - 5)),");
    const result = findAndEditNumericLiteral(content, "filledSurfaceHoverTone", 8);
    expect(result).not.toBeNull();
    expect(result).toContain("spec.role.tone - 8");
    expect(result).not.toContain("spec.role.tone - 5");
    // Clamp bounds (0 and 100) must remain unchanged.
    expect(result).toContain("Math.max(0, Math.min(100,");
  });

  // -------------------------------------------------------------------------
  // Math.round with expression:
  //   borderStrongToneComputed: Math.round(primaryTextTone - 57),
  // -------------------------------------------------------------------------
  it("Math.round with expression: replaces inner numeric literal", () => {
    const content = makeRecipe("borderStrongToneComputed: Math.round(primaryTextTone - 57),");
    const result = findAndEditNumericLiteral(content, "borderStrongToneComputed", 60);
    expect(result).not.toBeNull();
    expect(result).toContain("Math.round(primaryTextTone - 60)");
    expect(result).not.toContain("primaryTextTone - 57");
  });

  // -------------------------------------------------------------------------
  // Math.round of bare variable: roleIntensity: Math.round(roleIntensity),
  // No numeric literal inside — returns null.
  // -------------------------------------------------------------------------
  it("Math.round of bare variable: returns null (no numeric literal)", () => {
    const content = makeRecipe("roleIntensity: Math.round(roleIntensity),");
    const result = findAndEditNumericLiteral(content, "roleIntensity", 42);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Bare variable reference: contentTextTone: primaryTextTone,
  // -------------------------------------------------------------------------
  it("bare variable reference: returns null (no numeric literal)", () => {
    const content = makeRecipe("contentTextTone: primaryTextTone,");
    const result = findAndEditNumericLiteral(content, "contentTextTone", 50);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Spec path reference: filledSurfaceRestTone: spec.role.tone,
  // -------------------------------------------------------------------------
  it("spec path reference: returns null (no numeric literal)", () => {
    const content = makeRecipe("filledSurfaceRestTone: spec.role.tone,");
    const result = findAndEditNumericLiteral(content, "filledSurfaceRestTone", 50);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Math.max/Math.min clamped with bare variable (no offset):
  //   clampedTone: Math.max(0, Math.min(100, someVariable)),
  // The 0 and 100 are clamp bounds, not user-authored offsets — non-editable.
  // -------------------------------------------------------------------------
  it("clamped bare variable (no offset): returns null (clamp bounds not editable)", () => {
    const content = makeRecipe("clampedTone: Math.max(0, Math.min(100, someVariable)),");
    const result = findAndEditNumericLiteral(content, "clampedTone", 50);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Field not found: returns null.
  // -------------------------------------------------------------------------
  it("field not found: returns null", () => {
    const content = makeRecipe("otherField: 42,");
    const result = findAndEditNumericLiteral(content, "nonExistentField", 99);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Multiple fields: only the correct field is modified.
  // -------------------------------------------------------------------------
  it("only modifies the target field, not other fields", () => {
    const content = [
      "export function darkRecipe(spec) {",
      "  return {",
      "    mutedTextTone: primaryTextTone - 28,",
      "    subtleTextTone: primaryTextTone - 57,",
      "    disabledTextTone: primaryTextTone - 71,",
      "  };",
      "}",
    ].join("\n");

    const result = findAndEditNumericLiteral(content, "subtleTextTone", 60);
    expect(result).not.toBeNull();
    expect(result).toContain("mutedTextTone: primaryTextTone - 28,");
    expect(result).toContain("subtleTextTone: primaryTextTone - 60,");
    expect(result).toContain("disabledTextTone: primaryTextTone - 71,");
  });
});

// ---------------------------------------------------------------------------
// handleFormulaEdit tests
// ---------------------------------------------------------------------------

/** Absolute path used as the recipes directory in unit tests. */
const FAKE_RECIPES_DIR = "/fake/tugdeck/src/components/tugways/recipes";

/** Build a mock FormulasCache for a given mode. */
function makeFakeCache(mode: "dark" | "light"): FormulasCache {
  return {
    formulas: { surfaceAppIntensity: 2 },
    mode,
    themeName: "brio",
  };
}

/** Build a mock FsWriteImpl backed by an in-memory file store. */
function makeMockFs(initialFiles: Map<string, string>): FsWriteImpl & { written: Map<string, string> } {
  const store = new Map<string, string>(initialFiles);

  return {
    written: store,

    existsSync(p: string): boolean {
      return store.has(p);
    },

    readFileSync(p: string, _enc: "utf-8"): string {
      const content = store.get(p);
      if (content === undefined) throw new Error(`readFileSync: file not found: ${p}`);
      return content;
    },

    writeFileSync(p: string, data: string, _enc: "utf-8"): void {
      store.set(p, data);
    },

    readdirSync(_p: string): string[] {
      return [];
    },

    mkdirSync(_p: string, _opts: { recursive: boolean }): void {
      // no-op
    },
  };
}

describe("handleFormulaEdit", () => {
  it("valid edit returns 200 and updates recipe file", () => {
    const darkPath = path.join(FAKE_RECIPES_DIR, "dark.ts");
    const originalContent = makeRecipe("surfaceAppIntensity: 2,");
    const mockFs = makeMockFs(new Map([[darkPath, originalContent]]));
    const cache = makeFakeCache("dark");

    const result = handleFormulaEdit(
      { field: "surfaceAppIntensity", value: 5 },
      mockFs,
      cache,
      FAKE_RECIPES_DIR,
    );

    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { ok: boolean };
    expect(body.ok).toBe(true);

    const updatedContent = mockFs.written.get(darkPath);
    expect(updatedContent).toBeDefined();
    expect(updatedContent).toContain("surfaceAppIntensity: 5,");
    expect(updatedContent).not.toContain("surfaceAppIntensity: 2,");
  });

  it("missing field returns 404", () => {
    const darkPath = path.join(FAKE_RECIPES_DIR, "dark.ts");
    const originalContent = makeRecipe("someOtherField: 10,");
    const mockFs = makeMockFs(new Map([[darkPath, originalContent]]));
    const cache = makeFakeCache("dark");

    const result = handleFormulaEdit(
      { field: "nonExistentField", value: 42 },
      mockFs,
      cache,
      FAKE_RECIPES_DIR,
    );

    expect(result.status).toBe(404);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain("nonExistentField");
  });

  it("non-editable field (bare variable ref) returns 404", () => {
    const darkPath = path.join(FAKE_RECIPES_DIR, "dark.ts");
    const originalContent = makeRecipe("contentTextTone: primaryTextTone,");
    const mockFs = makeMockFs(new Map([[darkPath, originalContent]]));
    const cache = makeFakeCache("dark");

    const result = handleFormulaEdit(
      { field: "contentTextTone", value: 50 },
      mockFs,
      cache,
      FAKE_RECIPES_DIR,
    );

    expect(result.status).toBe(404);
  });

  it("invalid body (non-object) returns 400", () => {
    const mockFs = makeMockFs(new Map());
    const cache = makeFakeCache("dark");

    const result = handleFormulaEdit("not-an-object", mockFs, cache, FAKE_RECIPES_DIR);

    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain("invalid request body");
  });

  it("missing field property returns 400", () => {
    const mockFs = makeMockFs(new Map());
    const cache = makeFakeCache("dark");

    const result = handleFormulaEdit({ value: 42 }, mockFs, cache, FAKE_RECIPES_DIR);

    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain("field is required");
  });

  it("missing value property returns 400", () => {
    const mockFs = makeMockFs(new Map());
    const cache = makeFakeCache("dark");

    const result = handleFormulaEdit({ field: "surfaceAppIntensity" }, mockFs, cache, FAKE_RECIPES_DIR);

    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain("value");
  });

  it("null formulasCache returns 404 with 'no active theme'", () => {
    const mockFs = makeMockFs(new Map());

    const result = handleFormulaEdit(
      { field: "surfaceAppIntensity", value: 5 },
      mockFs,
      null,
      FAKE_RECIPES_DIR,
    );

    expect(result.status).toBe(404);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain("no active theme");
  });

  it("uses light.ts when cache mode is light", () => {
    const lightPath = path.join(FAKE_RECIPES_DIR, "light.ts");
    const originalContent = makeRecipe("surfaceAppIntensity: 3,");
    const mockFs = makeMockFs(new Map([[lightPath, originalContent]]));
    const cache = makeFakeCache("light");

    const result = handleFormulaEdit(
      { field: "surfaceAppIntensity", value: 7 },
      mockFs,
      cache,
      FAKE_RECIPES_DIR,
    );

    expect(result.status).toBe(200);
    const updatedContent = mockFs.written.get(lightPath);
    expect(updatedContent).toBeDefined();
    expect(updatedContent).toContain("surfaceAppIntensity: 7,");
  });
});
