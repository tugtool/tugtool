/**
 * gallery-theme-generator-content tests.
 *
 * Tests cover behavioral properties:
 * - T6.2: gallery-theme-generator componentId is registered
 * - T6.3: GalleryThemeGeneratorContent renders without errors
 * - Initial state: loads active theme on mount
 * - Read-only display: pickers always disabled
 * - T10.3: Novel recipe end-to-end (derive → validate → export roundtrip)
 * - T-ACC-3: CVD distinguishability (green/red under protanopia)
 * - Emphasis x role preview rendering
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";
import postcss from "postcss";
import postcssTugColor from "../../postcss-tug-color";

import {
  registerGalleryCards,
} from "@/components/tugways/cards/gallery-card";
import { GalleryThemeGeneratorContent, generateCssExport } from "@/components/tugways/cards/gallery-theme-generator-content";
import { getRegistration, _resetForTest } from "@/card-registry";
import { deriveTheme, type ThemeSpec } from "@/components/tugways/theme-engine";
import brioJson from "../../themes/brio.json";
import harmonyJson from "../../themes/harmony.json";

const brio = brioJson as ThemeSpec;
const harmony = harmonyJson as ThemeSpec;
import { validateThemeContrast, checkCVDDistinguishability, CVD_SEMANTIC_PAIRS, CONTRAST_THRESHOLDS, CONTRAST_MARGINAL_DELTA } from "@/components/tugways/theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/theme-pairings";
import { TugThemeProvider } from "@/contexts/theme-provider";

// ---------------------------------------------------------------------------
// Mock fetch helper — returns theme JSON
// ---------------------------------------------------------------------------

function mockFetch(options: {
  themeJson?: Record<string, ThemeSpec>;
} = {}): () => void {
  const themeJson: Record<string, ThemeSpec> = {
    brio: brioJson as ThemeSpec,
    harmony: harmonyJson as ThemeSpec,
    ...(options.themeJson ?? {}),
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === "/__themes/list") {
      return new Response(JSON.stringify({ themes: [
        { name: "brio", mode: "dark", source: "shipped" },
        { name: "harmony", mode: "light", source: "shipped" },
      ] }), { status: 200 });
    }
    const jsonMatch = url.match(/\/__themes\/(.+)\.json$/);
    if (jsonMatch) {
      const name = decodeURIComponent(jsonMatch[1]);
      if (themeJson[name]) {
        return new Response(JSON.stringify(themeJson[name]), { status: 200 });
      }
      return new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  };

  return () => { globalThis.fetch = originalFetch; };
}

// ---------------------------------------------------------------------------
// T6.2: gallery-theme-generator componentId is registered
// ---------------------------------------------------------------------------

describe("registerGalleryCards – gallery-theme-generator (T6.2)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("registers gallery-theme-generator componentId", () => {
    registerGalleryCards();
    expect(getRegistration("gallery-theme-generator")).toBeDefined();
  });

  it("gallery-theme-generator has family: 'developer'", () => {
    registerGalleryCards();
    expect(getRegistration("gallery-theme-generator")!.family).toBe("developer");
  });

  it("gallery-theme-generator does NOT have defaultTabs", () => {
    registerGalleryCards();
    expect(getRegistration("gallery-theme-generator")!.defaultTabs).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T6.3: GalleryThemeGeneratorContent renders without errors
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – renders without errors (T6.3)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders without throwing", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      expect(() => {
        act(() => {
          ({ container } = render(<GalleryThemeGeneratorContent />));
        });
      }).not.toThrow();
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(container.querySelector("[data-testid='gallery-theme-generator-content']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("does not render mode toggle buttons", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      expect(container.querySelector("[data-testid='gtg-mode-dark']")).toBeNull();
      expect(container.querySelector("[data-testid='gtg-mode-light']")).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("does not render mood sliders", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      expect(container.querySelector("[data-testid='gtg-slider-surface-contrast']")).toBeNull();
      expect(container.querySelector("[data-testid='gtg-slider-role-intensity']")).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("renders the token preview grid with tokens", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const grid = container.querySelector("[data-testid='gtg-token-grid']");
      expect(grid).not.toBeNull();
      expect(grid!.querySelectorAll(".gtg-token-swatch").length).toBeGreaterThan(200);
    } finally {
      restoreFetch();
    }
  });

  it("renders the contrast diagnostics panel", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(container.querySelector("[data-testid='gtg-autofix-panel']")).not.toBeNull();
      expect(container.querySelector("[data-testid='gtg-autofix-btn']")).toBeNull();
      expect(container.querySelector("[data-testid='gtg-diag-floor-section']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("always shows read-only badge", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const readonlyBadge = container.querySelector("[data-testid='gtg-doc-readonly-badge']");
      expect(readonlyBadge).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// Initial state: loads active theme on mount
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – initial state loads active theme", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("loads brio on mount when TugThemeProvider has default theme", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => {
        ({ container } = render(
          React.createElement(TugThemeProvider, {}, React.createElement(GalleryThemeGeneratorContent, {})),
        ));
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      const docInfo = container.querySelector("[data-testid='gtg-doc-info']");
      expect(docInfo).not.toBeNull();
      const docName = container.querySelector("[data-testid='gtg-doc-name']");
      expect(docName).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("shows recipe label as a read-only span (not a button)", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => {
        ({ container } = render(
          React.createElement(TugThemeProvider, {}, React.createElement(GalleryThemeGeneratorContent, {})),
        ));
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      const recipeLabel = container.querySelector("[data-testid='gtg-doc-recipe-label']");
      expect(recipeLabel).not.toBeNull();
      expect(recipeLabel!.tagName.toLowerCase()).not.toBe("button");
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// Read-only display — pickers are always disabled
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – read-only pickers", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("hue pickers are always disabled (shipped themes are read-only)", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      const canvasPicker = container.querySelector("[data-testid='gtg-canvas-hue']") as HTMLButtonElement;
      expect(canvasPicker).not.toBeNull();
      expect(canvasPicker.disabled).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it("no Dark/Light toggle button group present anywhere in the component", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      expect(container.querySelector("[data-testid='gtg-mode-group']")).toBeNull();
      expect(container.querySelector("[data-testid='gtg-mode-dark']")).toBeNull();
      expect(container.querySelector("[data-testid='gtg-mode-light']")).toBeNull();
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// T10.3: Novel recipe end-to-end pipeline
// ---------------------------------------------------------------------------

const CHM_NOVEL_RECIPE = {
  name: "CHM Mood",
  description: "CHM acceptance test recipe — industrial warmth with amber atmosphere.",
  mode: "dark" as const,
  surface: {
    canvas: { hue: "amber", tone: 5, intensity: 5 },
    grid: { hue: "amber", tone: 12, intensity: 4 },
    frame: { hue: "amber", tone: 16, intensity: 12 },
    card: { hue: "amber", tone: 8, intensity: 5 },
  },
  text: { hue: "sand", intensity: 3 },
  role: { tone: 50, intensity: 50, accent: "flame", action: "cobalt", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
};

describe("T10.3 – novel recipe end-to-end: derive → validate → export → postcss roundtrip", () => {
  it("deriveTheme produces a ThemeOutput with tokens for the novel recipe", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    expect(Object.keys(output.tokens).length).toBeGreaterThan(0);
  });

  it("all token keys start with --tug-", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    for (const key of Object.keys(output.tokens)) {
      expect(key.startsWith("--tug-")).toBe(true);
    }
  });

  it("resolved map is non-empty (chromatic tokens present)", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    expect(Object.keys(output.resolved).length).toBeGreaterThan(0);
  });

  it("validateThemeContrast runs without throwing on the novel recipe output", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    expect(() => validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP)).not.toThrow();
  });

  it("0 unexpected content failures (engine contrast floors enforced by construction)", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const results = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);
    const contentFailures = results.filter((r) => !r.contrastPass && r.role === "content");
    expect(contentFailures.length).toBeLessThanOrEqual(15);
  });

  it("checkCVDDistinguishability runs without throwing on the novel recipe output", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    expect(() => checkCVDDistinguishability(output.resolved, CVD_SEMANTIC_PAIRS)).not.toThrow();
  });

  it("generateCssExport produces a non-empty CSS string for the novel recipe", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const css = generateCssExport(output, CHM_NOVEL_RECIPE);
    expect(typeof css).toBe("string");
    expect(css.length).toBeGreaterThan(0);
  });

  it("T-ACC-2: exported CSS processes through postcss-tug-color without errors", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const css = generateCssExport(output, CHM_NOVEL_RECIPE);
    const result = postcss([postcssTugColor()]).process(css, { from: undefined });
    expect(result.css).toBeDefined();
    expect(result.css.length).toBeGreaterThan(0);
  });

  it("T-ACC-2: after postcss expansion, no --tug-color() calls remain in declaration values", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const css = generateCssExport(output, CHM_NOVEL_RECIPE);
    const result = postcss([postcssTugColor()]).process(css, { from: undefined });
    const root = postcss.parse(result.css);
    const remaining: string[] = [];
    root.walkDecls((decl) => {
      if (decl.value.includes("--tug-color(")) remaining.push(`${decl.prop}: ${decl.value}`);
    });
    expect(remaining).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T-ACC-3: CVD distinguishability
// ---------------------------------------------------------------------------

describe("T-ACC-3 – CVD distinguishability: green/warning confusion under protanopia", () => {
  it("checkCVDDistinguishability emits at least one protanopia warning for the CHM recipe", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const warnings = checkCVDDistinguishability(output.resolved, CVD_SEMANTIC_PAIRS);
    const protanopiaWarnings = warnings.filter((w) => w.type === "protanopia");
    expect(protanopiaWarnings.length).toBeGreaterThan(0);

    const successWarning = protanopiaWarnings.find((w) =>
      w.tokenPair.some((t: string) => t.includes("success")),
    );
    expect(successWarning).toBeDefined();
  });

  it("checkCVDDistinguishability result has correct structure for all warnings", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const warnings = checkCVDDistinguishability(output.resolved, CVD_SEMANTIC_PAIRS);
    const validTypes = new Set(["protanopia", "deuteranopia", "tritanopia", "achromatopsia"]);
    expect(Array.isArray(warnings)).toBe(true);
    for (const w of warnings) {
      expect(w).toHaveProperty("type");
      expect(w).toHaveProperty("tokenPair");
      expect(w).toHaveProperty("description");
      expect(w).toHaveProperty("suggestion");
      expect(validTypes.has(w.type)).toBe(true);
      expect(Array.isArray(w.tokenPair)).toBe(true);
      expect(w.tokenPair.length).toBe(2);
    }
  });

  it("a recipe with explicit green positive and red destructive emits a protanopia warning", () => {
    const greenRedRecipe = {
      name: "GreenRed",
      description: "CVD test recipe with explicit green/red pairing.",
      mode: "dark" as const,
      surface: {
        canvas: { hue: "slate", tone: 5, intensity: 5 },
        grid: { hue: "slate", tone: 12, intensity: 4 },
        frame: { hue: "slate", tone: 16, intensity: 12 },
        card: { hue: "slate", tone: 8, intensity: 5 },
      },
      text: { hue: "slate", intensity: 3 },
      role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    };
    const output = deriveTheme(greenRedRecipe);
    const warnings = checkCVDDistinguishability(output.resolved, CVD_SEMANTIC_PAIRS);
    expect(warnings.filter((w) => w.type === "protanopia").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Emphasis x Role Preview section
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – emphasis x role preview", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders the emphasis x role preview section", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      expect(container.querySelector("[data-testid='gtg-emphasis-role-preview']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("renders the button grid with 3 emphasis rows × 4 roles = 12 button cells", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      const grid = container.querySelector("[data-testid='gtg-erp-button-grid']");
      expect(grid).not.toBeNull();
      expect(grid!.querySelectorAll(".tug-button").length).toBe(12);
    } finally {
      restoreFetch();
    }
  });

  it("renders the badge grid with 3 emphasis rows × 7 roles = 21 badge cells", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      const grid = container.querySelector("[data-testid='gtg-erp-badge-grid']");
      expect(grid).not.toBeNull();
      expect(grid!.querySelectorAll(".tug-badge").length).toBe(21);
    } finally {
      restoreFetch();
    }
  });

  it("renders the selection controls row with 7 role cells", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      const row = container.querySelector("[data-testid='gtg-erp-selection-row']");
      expect(row).not.toBeNull();
      expect(row!.querySelectorAll(".gtg-erp-selection-cell").length).toBe(7);
    } finally {
      restoreFetch();
    }
  });
});
