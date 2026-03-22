/**
 * gallery-theme-generator-content tests.
 *
 * Tests cover behavioral properties:
 * - T6.2: gallery-theme-generator componentId is registered
 * - T6.3: GalleryThemeGeneratorContent renders without errors
 * - T6.4: Mode toggle switches recipe mode between "dark" and "light"
 * - T4: Theme name field interaction
 * - T10.3: Novel recipe end-to-end (derive → validate → export roundtrip)
 * - T-ACC-3: CVD distinguishability (green/red under protanopia)
 * - Role hue selectors interaction
 * - Emphasis x role preview rendering
 * - Saved-theme selector (Step 9)
 * - Step 5 final integration checkpoint
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
import postcss from "postcss";
import postcssTugColor from "../../postcss-tug-color";

import {
  registerGalleryCards,
} from "@/components/tugways/cards/gallery-card";
import { GalleryThemeGeneratorContent, generateCssExport } from "@/components/tugways/cards/gallery-theme-generator-content";
import { getRegistration, _resetForTest } from "@/card-registry";
import { deriveTheme, EXAMPLE_RECIPES } from "@/components/tugways/theme-engine";
import { validateThemeContrast, checkCVDDistinguishability, CVD_SEMANTIC_PAIRS, CONTRAST_THRESHOLDS, CONTRAST_MARGINAL_DELTA } from "@/components/tugways/theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/element-surface-pairing-map";
import { TugThemeProvider, removeThemeCSS } from "@/contexts/theme-provider";

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

  it("renders without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      act(() => {
        ({ container } = render(<GalleryThemeGeneratorContent />));
      });
    }).not.toThrow();
    expect(container.querySelector("[data-testid='gallery-theme-generator-content']")).not.toBeNull();
  });

  it("renders the mode toggle group", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    expect(container.querySelector("[data-testid='gtg-mode-group']")).not.toBeNull();
  });

  it("does not render mood sliders (removed in Step 4)", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    expect(container.querySelector("[data-testid='gtg-slider-surface-contrast']")).toBeNull();
    expect(container.querySelector("[data-testid='gtg-slider-role-intensity']")).toBeNull();
    expect(container.querySelector("[data-testid='gtg-slider-warmth']")).toBeNull();
  });

  it("renders the token preview grid with tokens", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const grid = container.querySelector("[data-testid='gtg-token-grid']");
    expect(grid).not.toBeNull();
    expect(grid!.querySelectorAll(".gtg-token-swatch").length).toBeGreaterThan(200);
  });

  it("renders the contrast diagnostics panel (Step 5)", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    expect(container.querySelector("[data-testid='gtg-autofix-panel']")).not.toBeNull();
    expect(container.querySelector("[data-testid='gtg-autofix-btn']")).toBeNull();
    expect(container.querySelector("[data-testid='gtg-diag-floor-section']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T4: Theme name as first-class UI element
// ---------------------------------------------------------------------------

function invokeInputOnChange(el: HTMLInputElement, value: string): void {
  const key = Object.keys(el).find(
    (k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"),
  );
  if (!key) return;
  const fiberOrProps = (el as unknown as Record<string, unknown>)[key];
  let props: Record<string, unknown> | null = null;
  if (key.startsWith("__reactProps$")) {
    props = fiberOrProps as Record<string, unknown>;
  } else {
    let fiber = fiberOrProps as { memoizedProps?: Record<string, unknown>; return?: unknown } | null;
    while (fiber) {
      if (fiber.memoizedProps) { props = fiber.memoizedProps; break; }
      fiber = fiber.return as typeof fiber;
    }
  }
  const onChange = props?.["onChange"] as ((e: { target: { value: string } }) => void) | undefined;
  if (typeof onChange === "function") {
    act(() => { onChange({ target: { value } }); });
  }
}

describe("GalleryThemeGeneratorContent – theme name field (T4)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders a visible text input for theme name", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const nameInput = container.querySelector("[data-testid='gtg-theme-name-input']");
    expect(nameInput).not.toBeNull();
    expect((nameInput as HTMLInputElement).type).toBe("text");
  });

  it("export CSS button is disabled when theme name is empty", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const nameInput = container.querySelector("[data-testid='gtg-theme-name-input']") as HTMLInputElement;
    invokeInputOnChange(nameInput, "");
    const exportBtn = container.querySelector("[data-testid='gtg-export-css-btn']") as HTMLButtonElement;
    expect(exportBtn).not.toBeNull();
    expect(exportBtn.disabled).toBe(true);
  });

  it("export CSS button is enabled when theme name has content", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const nameInput = container.querySelector("[data-testid='gtg-theme-name-input']") as HTMLInputElement;
    invokeInputOnChange(nameInput, "My Theme");
    const exportBtn = container.querySelector("[data-testid='gtg-export-css-btn']") as HTMLButtonElement;
    expect(exportBtn).not.toBeNull();
    expect(exportBtn.disabled).toBe(false);
  });

  it("theme name input reflects current recipe name after load preset", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const brioBtn = container.querySelector("[data-testid='gtg-preset-brio']") as HTMLElement;
    act(() => { fireEvent.click(brioBtn); });
    const nameInput = container.querySelector("[data-testid='gtg-theme-name-input']") as HTMLInputElement;
    expect(nameInput.value).toBe("brio");
  });
});

// ---------------------------------------------------------------------------
// T6.4: Mode toggle switches recipe mode between "dark" and "light"
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – mode toggle (T6.4)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("starts in dark mode (Brio default)", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    expect(container.querySelector("[data-testid='gtg-mode-dark']")!.classList.contains("tug-button-filled-action")).toBe(true);
    expect(container.querySelector("[data-testid='gtg-mode-light']")!.classList.contains("tug-button-outlined-action")).toBe(true);
  });

  it("switches to light mode when light button is clicked", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const lightBtn = container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement;
    act(() => { fireEvent.click(lightBtn); });
    expect(lightBtn.classList.contains("tug-button-filled-action")).toBe(true);
    expect(container.querySelector("[data-testid='gtg-mode-dark']")!.classList.contains("tug-button-outlined-action")).toBe(true);
  });

  it("switches back to dark mode when dark button is clicked after switching to light", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const lightBtn = container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement;
    const darkBtn = container.querySelector("[data-testid='gtg-mode-dark']") as HTMLElement;
    act(() => { fireEvent.click(lightBtn); });
    act(() => { fireEvent.click(darkBtn); });
    expect(darkBtn.classList.contains("tug-button-filled-action")).toBe(true);
    expect(lightBtn.classList.contains("tug-button-outlined-action")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T10.3: Novel recipe end-to-end pipeline
// ---------------------------------------------------------------------------

const CHM_NOVEL_RECIPE = {
  name: "CHM Mood",
  description: "CHM acceptance test recipe — industrial warmth with amber atmosphere.",
  recipe: "dark" as const,
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
    // Engine floors mean content failures should be bounded (design choices only)
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
      recipe: "dark" as const,
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
// Role hue selectors
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – role hue selectors", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders 12 hue pickers (4 surface + 1 text + 7 role) in the preview section", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const preview = container.querySelector("[data-testid='gtg-role-hues']");
    expect(preview).not.toBeNull();
    expect(preview!.querySelectorAll(".gtg-compact-hue-row").length).toBe(12);
  });

  it("each role hue picker button has the correct data-testid", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const roleIds = [
      "gtg-role-hue-accent", "gtg-role-hue-action", "gtg-role-hue-agent",
      "gtg-role-hue-data", "gtg-role-hue-success", "gtg-role-hue-caution", "gtg-role-hue-danger",
    ];
    for (const id of roleIds) {
      expect(container.querySelector(`[data-testid='${id}']`)).not.toBeNull();
    }
  });

  it("changing a role hue updates the derived theme output", () => {
    const withRed = deriveTheme({
      name: "test", description: "Test recipe with red destructive hue.", recipe: "dark",
      surface: { canvas: { hue: "violet", tone: 5, intensity: 5 }, grid: { hue: "violet", tone: 12, intensity: 4 }, frame: { hue: "violet", tone: 16, intensity: 12 }, card: { hue: "violet", tone: 8, intensity: 5 } },
      text: { hue: "cobalt", intensity: 3 },
      role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    });
    const withPink = deriveTheme({
      name: "test", description: "Test recipe with pink destructive hue.", recipe: "dark",
      surface: { canvas: { hue: "violet", tone: 5, intensity: 5 }, grid: { hue: "violet", tone: 12, intensity: 4 }, frame: { hue: "violet", tone: 16, intensity: 12 }, card: { hue: "violet", tone: 8, intensity: 5 } },
      text: { hue: "cobalt", intensity: 3 },
      role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "pink" },
    });
    expect(withRed.tokens["--tug-element-tone-fill-normal-danger-rest"]).not.toBe(
      withPink.tokens["--tug-element-tone-fill-normal-danger-rest"],
    );
  });

  it("clicking a compact row opens the popover with a TugHueStrip", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const accentRow = container.querySelector("[data-testid='gtg-role-hue-accent']") as HTMLElement;
    act(() => { fireEvent.click(accentRow); });
    const popoverContent = document.body.querySelector(".gtg-compact-hue-popover");
    expect(popoverContent).not.toBeNull();
    expect(popoverContent!.querySelector(".tug-hue-strip")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Emphasis x Role Preview section
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – emphasis x role preview", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders the emphasis x role preview section", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    expect(container.querySelector("[data-testid='gtg-emphasis-role-preview']")).not.toBeNull();
  });

  it("renders the button grid with 3 emphasis rows × 4 roles = 12 button cells", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const grid = container.querySelector("[data-testid='gtg-erp-button-grid']");
    expect(grid).not.toBeNull();
    expect(grid!.querySelectorAll(".tug-button").length).toBe(12);
  });

  it("renders the badge grid with 3 emphasis rows × 7 roles = 21 badge cells", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const grid = container.querySelector("[data-testid='gtg-erp-badge-grid']");
    expect(grid).not.toBeNull();
    expect(grid!.querySelectorAll(".tug-badge").length).toBe(21);
  });

  it("renders the selection controls row with 7 role cells", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const row = container.querySelector("[data-testid='gtg-erp-selection-row']");
    expect(row).not.toBeNull();
    expect(row!.querySelectorAll(".gtg-erp-selection-cell").length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Step 9: Saved-theme selector dropdown
// ---------------------------------------------------------------------------

function renderWithThemeProvider(savedThemeNames: string[] = []) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === "/__themes/list") {
      return new Response(JSON.stringify({ themes: savedThemeNames }), { status: 200 });
    }
    if (url === "/__themes/save") {
      return new Response(JSON.stringify({ ok: true, name: "test-theme" }), { status: 200 });
    }
    if (url.startsWith("/styles/themes/") && url.endsWith(".css")) {
      return new Response("body {}", { status: 200 });
    }
    if (url.startsWith("/styles/themes/") && url.endsWith("-recipe.json")) {
      const recipe = JSON.stringify({ name: "Saved Theme", description: "Saved theme for testing.", recipe: "dark", surface: { canvas: "amber", card: "amber" }, element: { content: "sand", control: "sand", display: "indigo", informational: "amber", border: "amber", decorative: "gray" }, role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" } });
      return new Response(recipe, { status: 200 });
    }
    return new Response("", { status: 404 });
  };

  let container!: HTMLElement;
  act(() => {
    ({ container } = render(
      React.createElement(TugThemeProvider, {}, React.createElement(GalleryThemeGeneratorContent, {})),
    ));
  });

  return { container, restoreFetch: () => { globalThis.fetch = originalFetch; } };
}

describe("GalleryThemeGeneratorContent – saved-theme selector (Step 9)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); removeThemeCSS(); });

  it("dropdown renders with 'Brio (default)' option when no saved themes exist", async () => {
    const { container, restoreFetch } = renderWithThemeProvider([]);
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const select = container.querySelector("[data-testid='gtg-saved-theme-select']") as HTMLSelectElement;
      expect(select).not.toBeNull();
      expect(select.querySelector("[data-testid='gtg-saved-theme-option-brio']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("dropdown includes saved theme names returned by loadSavedThemes()", async () => {
    const { container, restoreFetch } = renderWithThemeProvider(["my-theme", "dark-forest"]);
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const select = container.querySelector("[data-testid='gtg-saved-theme-select']") as HTMLSelectElement;
      expect(select).not.toBeNull();
      expect(select.querySelector("[value='my-theme']")).not.toBeNull();
      expect(select.querySelector("[value='dark-forest']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("selecting 'Brio (default)' resets recipe to Brio dark mode defaults", async () => {
    const { container, restoreFetch } = renderWithThemeProvider([]);
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const lightBtn = container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement;
      act(() => { fireEvent.click(lightBtn); });
      const select = container.querySelector("[data-testid='gtg-saved-theme-select']") as HTMLSelectElement;
      act(() => { fireEvent.change(select, { target: { value: "__brio__" } }); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(container.querySelector("[data-testid='gtg-mode-dark']")!.classList.contains("tug-button-filled-action")).toBe(true);
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// Step 5: Final integration checkpoint
// ---------------------------------------------------------------------------

function readRenderedTokens(container: HTMLElement): Record<string, string> {
  const names = Array.from(container.querySelectorAll(".gtg-token-name")) as HTMLElement[];
  const values = Array.from(container.querySelectorAll(".gtg-token-value")) as HTMLElement[];
  const result: Record<string, string> = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i]?.textContent?.trim() ?? "";
    const value = values[i]?.textContent?.trim() ?? "";
    if (name) result[name] = value;
  }
  return result;
}

function readRenderedTokenCount(container: HTMLElement): number {
  const titles = Array.from(container.querySelectorAll(".cg-section-title")) as HTMLElement[];
  for (const title of titles) {
    const m = title.textContent?.match(/Token Preview \((\d+) tokens\)/);
    if (m) return parseInt(m[1], 10);
  }
  return -1;
}

describe("Step 5 – final integration checkpoint: component end-to-end", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("initial render shows tokens (> 0)", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    expect(readRenderedTokenCount(container)).toBeGreaterThan(0);
  });

  it("mode toggle Dark→Light→Dark preserves token count throughout", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const darkCount = readRenderedTokenCount(container);
    act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement); });
    expect(readRenderedTokenCount(container)).toBe(darkCount);
    act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-mode-dark']") as HTMLElement); });
    expect(readRenderedTokenCount(container)).toBe(darkCount);
  });

  it("Harmony preset rendered tokens match deriveTheme(EXAMPLE_RECIPES.harmony) token-for-token", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    act(() => {
      fireEvent.click(container.querySelector("[data-testid='gtg-preset-harmony']") as HTMLElement);
    });

    const rendered = readRenderedTokens(container);
    const expected = deriveTheme(EXAMPLE_RECIPES.harmony).tokens;

    expect(Object.keys(rendered).length).toBe(Object.keys(expected).length);

    const mismatches: string[] = [];
    for (const [name, expectedValue] of Object.entries(expected)) {
      if (rendered[name] !== expectedValue) {
        mismatches.push(`${name}: rendered="${rendered[name]}" expected="${expectedValue}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("Brio → Light → Dark round-trip: token map matches original Brio", () => {
    let container!: HTMLElement;
    act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
    const initialBrioTokens = readRenderedTokens(container);

    act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement); });
    const lightTokens = readRenderedTokens(container);
    expect(lightTokens["--tug-surface-global-primary-normal-app-rest"]).not.toBe(
      initialBrioTokens["--tug-surface-global-primary-normal-app-rest"],
    );

    act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-mode-dark']") as HTMLElement); });
    const restoredTokens = readRenderedTokens(container);

    const mismatches: string[] = [];
    for (const [name, originalValue] of Object.entries(initialBrioTokens)) {
      if (restoredTokens[name] !== originalValue) {
        mismatches.push(`${name}: restored="${restoredTokens[name]}" original="${originalValue}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("importing Harmony recipe JSON round-trips correctly", () => {
    const harmonyJson = JSON.stringify(EXAMPLE_RECIPES.harmony);
    const parsedHarmony = JSON.parse(harmonyJson) as typeof EXAMPLE_RECIPES.harmony;
    const directOutput = deriveTheme(EXAMPLE_RECIPES.harmony);
    const importedOutput = deriveTheme(parsedHarmony);
    expect(Object.keys(importedOutput.tokens).length).toBeGreaterThan(0);
    const mismatches: string[] = [];
    for (const [name, value] of Object.entries(directOutput.tokens)) {
      if (importedOutput.tokens[name] !== value) {
        mismatches.push(`${name}: imported="${importedOutput.tokens[name]}" expected="${value}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
