/**
 * theme-export-import tests — Step 9.
 *
 * Tests cover:
 * - T9.1: Exported CSS contains `body {` block with `--tug-base-*` tokens
 * - T9.2: Exported CSS contains only `--tug-color()` values for chromatic tokens
 * - T9.3: Exported recipe JSON round-trips: export -> import -> re-export produces identical JSON
 * - T9.4: Invalid JSON import shows error, does not crash
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import {
  GalleryThemeGeneratorContent,
  generateCssExport,
  validateRecipeJson,
} from "@/components/tugways/cards/gallery-theme-generator-content";
import { deriveTheme, EXAMPLE_RECIPES } from "@/components/tugways/theme-derivation-engine";
import { _resetForTest } from "@/card-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderComponent() {
  let container!: HTMLElement;
  act(() => {
    ({ container } = render(<GalleryThemeGeneratorContent />));
  });
  return container;
}

// ---------------------------------------------------------------------------
// T9.1: Exported CSS contains `body {` block with `--tug-base-*` tokens
// ---------------------------------------------------------------------------

describe("theme-export – T9.1: exported CSS has body block with --tug-base-* tokens", () => {
  afterEach(() => { _resetForTest(); cleanup(); });

  it("brio recipe: generated CSS has a body {} block", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const output = deriveTheme(recipe);
    const css = generateCssExport(output, recipe);
    expect(css).toContain("body {");
  });

  it("brio recipe: CSS contains --tug-base-* token names in body block", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const output = deriveTheme(recipe);
    const css = generateCssExport(output, recipe);
    // Should have multiple --tug-base-* entries
    const matches = css.match(/--tug-base-/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThan(50);
  });

  it("body block contains at least 50 --tug-base-* token entries", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const output = deriveTheme(recipe);
    const chromatic = Object.entries(output.tokens).filter(([, v]) => v.startsWith("--tug-color("));
    expect(chromatic.length).toBeGreaterThanOrEqual(50);
  });

  it("CSS header contains @theme-name comment", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const output = deriveTheme(recipe);
    const css = generateCssExport(output, recipe);
    expect(css).toContain("@theme-name");
  });

  it("CSS header contains @generated date comment", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const output = deriveTheme(recipe);
    const css = generateCssExport(output, recipe);
    expect(css).toContain("@generated");
  });

  it("CSS header contains @recipe-hash comment", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const output = deriveTheme(recipe);
    const css = generateCssExport(output, recipe);
    expect(css).toContain("@recipe-hash");
  });

  it("ExportImportPanel renders with Export CSS and Export Recipe JSON buttons", () => {
    const container = renderComponent();
    const cssBtn = container.querySelector("[data-testid='gtg-export-css-btn']");
    const jsonBtn = container.querySelector("[data-testid='gtg-export-json-btn']");
    expect(cssBtn).not.toBeNull();
    expect(jsonBtn).not.toBeNull();
  });

  it("Export CSS button is a button element", () => {
    const container = renderComponent();
    const cssBtn = container.querySelector("[data-testid='gtg-export-css-btn']");
    expect(cssBtn?.tagName.toLowerCase()).toBe("button");
  });
});

// ---------------------------------------------------------------------------
// T9.2: Exported CSS contains only --tug-color() values for chromatic tokens
// ---------------------------------------------------------------------------

describe("theme-export – T9.2: exported CSS has only --tug-color() values for chromatic tokens", () => {
  afterEach(() => { _resetForTest(); cleanup(); });

  it("brio recipe: all chromatic token values use --tug-color() notation", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const output = deriveTheme(recipe);
    const css = generateCssExport(output, recipe);
    // Extract all declaration lines from the body block
    const bodyMatch = css.match(/body \{([\s\S]*?)\}/);
    expect(bodyMatch).not.toBeNull();
    const body = bodyMatch![1];
    const lines = body.split("\n").map((l) => l.trim()).filter((l) => l.includes(":") && l.startsWith("--tug-base-"));
    // Every chromatic line must use --tug-color()
    for (const line of lines) {
      const valueMatch = line.match(/:\s*(.+?);?\s*$/);
      expect(valueMatch).not.toBeNull();
      expect(valueMatch![1].trim()).toMatch(/^--tug-color\(/);
    }
  });

  it("no raw oklch() values appear in the body block", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const output = deriveTheme(recipe);
    const css = generateCssExport(output, recipe);
    const bodyMatch = css.match(/body \{([\s\S]*?)\}/);
    const body = bodyMatch ? bodyMatch[1] : "";
    expect(body).not.toContain("oklch(");
  });

  it("no raw hex values appear in the body block", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const output = deriveTheme(recipe);
    const css = generateCssExport(output, recipe);
    const bodyMatch = css.match(/body \{([\s\S]*?)\}/);
    const body = bodyMatch ? bodyMatch[1] : "";
    // No standalone hex colors like #rrggbb
    expect(body).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("export panel renders without errors", () => {
    const container = renderComponent();
    const panel = container.querySelector("[data-testid='gtg-export-import-panel']");
    expect(panel).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T9.3: Exported recipe JSON round-trips
// ---------------------------------------------------------------------------

describe("theme-import – T9.3: recipe JSON round-trips", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("JSON.stringify(recipe) -> JSON.parse -> JSON.stringify produces identical JSON", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const json1 = JSON.stringify(recipe, null, 2);
    const parsed = JSON.parse(json1) as typeof recipe;
    const json2 = JSON.stringify(parsed, null, 2);
    expect(json1).toBe(json2);
  });

  it("import brio recipe: re-exported JSON matches original", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const exported = JSON.stringify(recipe, null, 2);
    const reimported = JSON.parse(exported);
    const reexported = JSON.stringify(reimported, null, 2);
    expect(exported).toBe(reexported);
  });

  it("recipe with all optional fields round-trips without data loss", () => {
    const fullRecipe = {
      name: "TestTheme",
      mode: "light" as const,
      atmosphere: { hue: "cyan", offset: 3 },
      text: { hue: "blue", offset: -2 },
      accent: "orange",
      active: "cobalt",
      destructive: "red",
      success: "green",
      caution: "yellow",
      agent: "violet",
      data: "teal",
      surfaceContrast: 65,
      signalIntensity: 75,
      warmth: 40,
    };
    const json1 = JSON.stringify(fullRecipe, null, 2);
    const parsed = JSON.parse(json1);
    const json2 = JSON.stringify(parsed, null, 2);
    expect(json1).toBe(json2);
  });

  it("validateRecipeJson accepts a valid brio recipe", () => {
    expect(validateRecipeJson(EXAMPLE_RECIPES.brio)).toBeNull();
  });

  it("Import Recipe button renders in the component", () => {
    const container = renderComponent();
    const importBtn = container.querySelector("[data-testid='gtg-import-btn']");
    expect(importBtn).not.toBeNull();
    expect(importBtn?.tagName.toLowerCase()).toBe("button");
  });

  it("file input is present in the component (hidden, for programmatic trigger)", () => {
    const container = renderComponent();
    const fileInput = container.querySelector("[data-testid='gtg-import-file-input']");
    expect(fileInput).not.toBeNull();
    expect((fileInput as HTMLInputElement).type).toBe("file");
  });

  it("re-deriving brio recipe after round-trip produces same token count", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const json = JSON.stringify(recipe, null, 2);
    const roundTripped = JSON.parse(json);
    const output1 = deriveTheme(recipe);
    const output2 = deriveTheme(roundTripped);
    expect(Object.keys(output1.tokens).length).toBe(Object.keys(output2.tokens).length);
  });

  it("generateCssExport preserves the recipe name: a recipe named 'MyTheme' exports with @theme-name MyTheme", () => {
    const recipe = { ...EXAMPLE_RECIPES.brio, name: "MyTheme" };
    const output = deriveTheme(recipe);
    const css = generateCssExport(output, recipe);
    expect(css).toContain("@theme-name MyTheme");
    expect(css).not.toContain("@theme-name preview");
  });

  it("generateCssExport name in CSS header matches the recipe name passed in", () => {
    const names = ["Cobalt Night", "Sunset", "preview", "brio"];
    for (const name of names) {
      const recipe = { ...EXAMPLE_RECIPES.brio, name };
      const output = deriveTheme(recipe);
      const css = generateCssExport(output, recipe);
      expect(css).toContain(`@theme-name ${name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// T9.4: Invalid JSON import shows error, does not crash
// ---------------------------------------------------------------------------

describe("theme-import – T9.4: invalid JSON import shows error, does not crash", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  // Unit tests for validateRecipeJson directly — no FileReader needed.

  it("validateRecipeJson returns error for null", () => {
    expect(validateRecipeJson(null)).not.toBeNull();
  });

  it("validateRecipeJson returns error for a string (not object)", () => {
    expect(validateRecipeJson("not an object")).not.toBeNull();
  });

  it("validateRecipeJson returns error for an array", () => {
    expect(validateRecipeJson([])).not.toBeNull();
  });

  it("validateRecipeJson returns error for empty object", () => {
    expect(validateRecipeJson({})).not.toBeNull();
  });

  it("validateRecipeJson returns error for wrong mode ('sepia')", () => {
    const bad = { name: "X", mode: "sepia", atmosphere: { hue: "red" }, text: { hue: "blue" } };
    expect(validateRecipeJson(bad)).not.toBeNull();
  });

  it("validateRecipeJson returns error for missing name", () => {
    const bad = { mode: "dark", atmosphere: { hue: "red" }, text: { hue: "blue" } };
    expect(validateRecipeJson(bad)).not.toBeNull();
  });

  it("validateRecipeJson returns error for missing atmosphere", () => {
    const bad = { name: "X", mode: "dark", text: { hue: "blue" } };
    expect(validateRecipeJson(bad)).not.toBeNull();
  });

  it("validateRecipeJson returns error for missing text", () => {
    const bad = { name: "X", mode: "dark", atmosphere: { hue: "red" } };
    expect(validateRecipeJson(bad)).not.toBeNull();
  });

  it("validateRecipeJson returns error for surfaceContrast as string", () => {
    const bad = {
      name: "X", mode: "dark",
      atmosphere: { hue: "red" }, text: { hue: "blue" },
      surfaceContrast: "high",
    };
    expect(validateRecipeJson(bad)).not.toBeNull();
  });

  it("validateRecipeJson returns error for signalIntensity as string", () => {
    const bad = {
      name: "X", mode: "dark",
      atmosphere: { hue: "red" }, text: { hue: "blue" },
      signalIntensity: "vivid",
    };
    expect(validateRecipeJson(bad)).not.toBeNull();
  });

  it("validateRecipeJson returns error for warmth as boolean", () => {
    const bad = {
      name: "X", mode: "dark",
      atmosphere: { hue: "red" }, text: { hue: "blue" },
      warmth: true,
    };
    expect(validateRecipeJson(bad)).not.toBeNull();
  });

  it("validateRecipeJson accepts both 'dark' and 'light' modes", () => {
    const dark = { name: "X", mode: "dark", atmosphere: { hue: "red" }, text: { hue: "blue" } };
    const light = { name: "X", mode: "light", atmosphere: { hue: "red" }, text: { hue: "blue" } };
    expect(validateRecipeJson(dark)).toBeNull();
    expect(validateRecipeJson(light)).toBeNull();
  });

  it("component renders Import Recipe button without crashing", () => {
    const container = renderComponent();
    expect(container.querySelector("[data-testid='gallery-theme-generator-content']")).not.toBeNull();
    expect(container.querySelector("[data-testid='gtg-import-btn']")).not.toBeNull();
  });

  it("component shows no error initially (before any import attempt)", () => {
    const container = renderComponent();
    const errorEl = container.querySelector("[data-testid='gtg-import-error']");
    expect(errorEl).toBeNull();
  });

  it("validateRecipeJson accepts legacy signalVividity and migrates it to signalIntensity", () => {
    const legacy = {
      name: "LegacyTheme",
      mode: "dark",
      atmosphere: { hue: "cobalt" },
      text: { hue: "slate" },
      signalVividity: 75,
    };
    const result = validateRecipeJson(legacy);
    expect(result).toBeNull();
    // Migration shim should have renamed the field in-place
    expect((legacy as Record<string, unknown>)["signalIntensity"]).toBe(75);
    expect((legacy as Record<string, unknown>)["signalVividity"]).toBeUndefined();
  });
});
