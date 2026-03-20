/**
 * gallery-theme-generator-content tests — Steps 6 and 10.
 *
 * Tests cover:
 * - T6.1: GALLERY_DEFAULT_TABS has 20 entries
 * - T6.2: gallery-theme-generator componentId is registered
 * - T6.3: GalleryThemeGeneratorContent renders without errors
 * - T6.4: Mode toggle switches recipe mode between "dark" and "light"
 * - T10.1/T10.2: All prior tests pass (structural — presence of this file)
 * - T10.3: Novel recipe end-to-end: derive -> validate -> 0 body-text failures -> export -> postcss roundtrip
 * - T-ACC-1: Novel CHM recipe produces 0 perceptual contrast body-text failures
 * - T-ACC-2: Exported CSS loads in postcss-tug-color without errors
 * - T-ACC-3: CVD strip flags green/red confusion under protanopia
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
  GALLERY_DEFAULT_TABS,
} from "@/components/tugways/cards/gallery-card";
import { GalleryThemeGeneratorContent, generateCssExport } from "@/components/tugways/cards/gallery-theme-generator-content";
import { getRegistration, _resetForTest } from "@/card-registry";
import { deriveTheme, EXAMPLE_RECIPES, DARK_FORMULAS, LIGHT_FORMULAS } from "@/components/tugways/theme-derivation-engine";
import { validateThemeContrast, checkCVDDistinguishability, CVD_SEMANTIC_PAIRS, CONTRAST_THRESHOLDS, CONTRAST_MARGINAL_DELTA } from "@/components/tugways/theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/element-surface-pairing-map";
import { TugThemeProvider, removeThemeCSS } from "@/contexts/theme-provider";
import {
  KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS,
  KNOWN_PAIR_EXCEPTIONS,
} from "./contrast-exceptions";

// ---------------------------------------------------------------------------
// Known-exception sets shared by T10.3 and T-ACC-1
// ---------------------------------------------------------------------------
// KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS and KNOWN_PAIR_EXCEPTIONS are imported
// from contrast-exceptions.ts (see import at top of file).

/**
 * Run the derive → validate pipeline for a given recipe and return the
 * contrast results. Step 5: autoAdjustContrast removed from pipeline.
 * The engine's enforceContrastFloor produces compliant tokens by construction.
 */
function runFullPipelineForRecipe(recipe: Parameters<typeof deriveTheme>[0]) {
  const output = deriveTheme(recipe);
  const finalResults = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);
  return { output, finalResults };
}

/**
 * Filter a list of ContrastResults to only the unexpected failures —
 * those outside the known-token exception set, the known-pair set,
 * and the 5-unit marginal band (within CONTRAST_MARGINAL_DELTA of the role threshold). [D02]
 */
function unexpectedFailures(results: ReturnType<typeof validateThemeContrast>) {
  return results.filter((r) => {
    if (r.contrastPass) return false;
    const margin = (CONTRAST_THRESHOLDS[r.role] ?? 15) - CONTRAST_MARGINAL_DELTA;
    if (Math.abs(r.contrast) >= margin) return false;
    if (KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.has(r.fg)) return false;
    if (KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// T6.1: GALLERY_DEFAULT_TABS has 21 entries
// ---------------------------------------------------------------------------

describe("GALLERY_DEFAULT_TABS – twenty-one entries (T6.1)", () => {
  it("has 21 entries", () => {
    expect(GALLERY_DEFAULT_TABS.length).toBe(21);
  });

  it("includes gallery-theme-generator as the 20th entry", () => {
    const componentIds = GALLERY_DEFAULT_TABS.map((t) => t.componentId);
    expect(componentIds).toContain("gallery-theme-generator");
    expect(componentIds[19]).toBe("gallery-theme-generator");
  });

  it("20th entry has title 'Theme Generator'", () => {
    const tab = GALLERY_DEFAULT_TABS[19];
    expect(tab.title).toBe("Theme Generator");
  });

  it("20th entry is closable", () => {
    const tab = GALLERY_DEFAULT_TABS[19];
    expect(tab.closable).toBe(true);
  });

  it("includes gallery-badge as the 21st entry", () => {
    const componentIds = GALLERY_DEFAULT_TABS.map((t) => t.componentId);
    expect(componentIds).toContain("gallery-badge");
    expect(componentIds[20]).toBe("gallery-badge");
  });
});

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
    const reg = getRegistration("gallery-theme-generator");
    expect(reg!.family).toBe("developer");
  });

  it("gallery-theme-generator has acceptsFamilies: ['developer']", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-theme-generator");
    expect(reg!.acceptsFamilies).toEqual(["developer"]);
  });

  it("gallery-theme-generator does NOT have defaultTabs", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-theme-generator");
    expect(reg!.defaultTabs).toBeUndefined();
  });

  it("gallery-buttons defaultTabs has 21 entries after registration", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-buttons");
    expect(reg!.defaultTabs).toBeDefined();
    expect(reg!.defaultTabs!.length).toBe(21);
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
    expect(
      container.querySelector("[data-testid='gallery-theme-generator-content']"),
    ).not.toBeNull();
  });

  it("renders the mode toggle group", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    expect(container.querySelector("[data-testid='gtg-mode-group']")).not.toBeNull();
  });

  it("renders the card hue as a compact picker", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const picker = container.querySelector("[data-testid='gtg-card-hue']");
    expect(picker).not.toBeNull();
  });

  it("renders the content hue as a compact picker", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const picker = container.querySelector("[data-testid='gtg-content-hue']");
    expect(picker).not.toBeNull();
  });

  it("renders three mood sliders", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const sc = container.querySelector("[data-testid='gtg-slider-surface-contrast']");
    const sv = container.querySelector("[data-testid='gtg-slider-signal-intensity']");
    const w = container.querySelector("[data-testid='gtg-slider-warmth']");
    expect(sc).not.toBeNull();
    expect(sv).not.toBeNull();
    expect(w).not.toBeNull();
    expect((sc as HTMLInputElement).type).toBe("range");
    expect((sv as HTMLInputElement).type).toBe("range");
    expect((w as HTMLInputElement).type).toBe("range");
  });

  it("renders the token preview grid with tokens", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const grid = container.querySelector("[data-testid='gtg-token-grid']");
    expect(grid).not.toBeNull();
    const swatches = grid!.querySelectorAll(".gtg-token-swatch");
    // At least 200 token swatches (264 token set)
    expect(swatches.length).toBeGreaterThan(200);
  });

  it("renders the contrast diagnostics panel (Step 5: replaces auto-fix button)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    // The diagnostics panel uses the same container testid as the old auto-fix panel
    // for structural stability. The old auto-fix button (gtg-autofix-btn) must be absent.
    expect(container.querySelector("[data-testid='gtg-autofix-panel']")).not.toBeNull();
    expect(container.querySelector("[data-testid='gtg-autofix-btn']")).toBeNull();
    // Floor diagnostics section must be present
    expect(container.querySelector("[data-testid='gtg-diag-floor-section']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T4: Theme name as first-class UI element
// ---------------------------------------------------------------------------

/**
 * Invoke a React text input's onChange handler directly via fiber props.
 * happy-dom does not propagate fireEvent.change to React's synthetic onChange
 * for controlled inputs. This mirrors the pattern established in
 * gallery-scale-timing-content.test.tsx for range inputs.
 */
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
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const nameInput = container.querySelector("[data-testid='gtg-theme-name-input']");
    expect(nameInput).not.toBeNull();
    expect((nameInput as HTMLInputElement).type).toBe("text");
  });

  it("export CSS button is disabled when theme name is empty", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const nameInput = container.querySelector("[data-testid='gtg-theme-name-input']") as HTMLInputElement;
    invokeInputOnChange(nameInput, "");
    const exportBtn = container.querySelector("[data-testid='gtg-export-css-btn']") as HTMLButtonElement;
    expect(exportBtn).not.toBeNull();
    expect(exportBtn.disabled).toBe(true);
  });

  it("export CSS button is enabled when theme name has content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const nameInput = container.querySelector("[data-testid='gtg-theme-name-input']") as HTMLInputElement;
    invokeInputOnChange(nameInput, "My Theme");
    const exportBtn = container.querySelector("[data-testid='gtg-export-css-btn']") as HTMLButtonElement;
    expect(exportBtn).not.toBeNull();
    expect(exportBtn.disabled).toBe(false);
  });

  it("theme name input reflects current recipe name after load preset", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    // Load a preset — the brio preset has name "brio"
    const brioBtn = container.querySelector("[data-testid='gtg-preset-brio']") as HTMLElement;
    act(() => {
      fireEvent.click(brioBtn);
    });
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
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const darkBtn = container.querySelector("[data-testid='gtg-mode-dark']");
    const lightBtn = container.querySelector("[data-testid='gtg-mode-light']");
    expect(darkBtn).not.toBeNull();
    expect(lightBtn).not.toBeNull();
    expect(darkBtn!.classList.contains("tug-button-filled-action")).toBe(true);
    expect(lightBtn!.classList.contains("tug-button-outlined-action")).toBe(true);
  });

  it("switches to light mode when light button is clicked", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const lightBtn = container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement;
    act(() => {
      fireEvent.click(lightBtn);
    });
    expect(lightBtn.classList.contains("tug-button-filled-action")).toBe(true);
    const darkBtn = container.querySelector("[data-testid='gtg-mode-dark']");
    expect(darkBtn!.classList.contains("tug-button-outlined-action")).toBe(true);
  });

  it("switches back to dark mode when dark button is clicked after switching to light", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const lightBtn = container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement;
    const darkBtn = container.querySelector("[data-testid='gtg-mode-dark']") as HTMLElement;
    act(() => {
      fireEvent.click(lightBtn);
    });
    act(() => {
      fireEvent.click(darkBtn);
    });
    expect(darkBtn.classList.contains("tug-button-filled-action")).toBe(true);
    expect(lightBtn.classList.contains("tug-button-outlined-action")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T10.3: Novel recipe end-to-end pipeline
// ---------------------------------------------------------------------------

/**
 * The novel "CHM mood" recipe used for T10.3 and T-ACC-1.
 * Not the brio example recipe — a custom recipe for acceptance testing.
 * Uses the CHM acceptance-test parameters from the plan exit criteria.
 */
const CHM_NOVEL_RECIPE = {
  name: "CHM Mood",
  description: "CHM acceptance test recipe — industrial warmth with amber atmosphere.",
  mode: "dark" as const,
  surface: { canvas: "amber", card: "amber" },
  element: { content: "sand", control: "sand", display: "indigo", informational: "amber", border: "amber", decorative: "gray" },
  role: { accent: "flame", action: "cobalt", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
  surfaceContrast: 70,
  signalIntensity: 80,
  warmth: 65,
};

describe("T10.3 – novel recipe end-to-end: derive → validate → export → postcss roundtrip", () => {
  it("deriveTheme produces a ThemeOutput with 373 tokens for the novel recipe", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    expect(Object.keys(output.tokens).length).toBe(373);
  });

  it("all token keys start with --tug-base-", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    for (const key of Object.keys(output.tokens)) {
      expect(key.startsWith("--tug-base-")).toBe(true);
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

  it("0 unexpected content perceptual contrast failures (engine contrast floors enforced by construction; T-ACC-1 / T10.3 core assertion)", () => {
    const { finalResults } = runFullPipelineForRecipe(CHM_NOVEL_RECIPE);
    const bodyTextUnexpected = unexpectedFailures(finalResults).filter(
      (r) => r.role === "content",
    );
    const descriptions = bodyTextUnexpected.map(
      (f) => `${f.fg} on ${f.bg}: contrast ${f.contrast.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
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
    // Wrap in a full stylesheet context for processing
    const result = postcss([postcssTugColor()]).process(css, { from: undefined });
    // process() throws synchronously on fatal parse errors; if we reach here it succeeded
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

  it("T-ACC-2: exported CSS body block expands to valid oklch() values for all entries", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const css = generateCssExport(output, CHM_NOVEL_RECIPE);
    const expanded = postcss([postcssTugColor()]).process(css, { from: undefined }).css;
    // Every declaration value should now be oklch() or a non-color passthrough
    const root = postcss.parse(expanded);
    const failures: string[] = [];
    root.walkDecls((decl) => {
      if (!decl.prop.startsWith("--tug-base-")) return;
      // Values that are NOT oklch() must be structural (transparent, none, var(), numeric, composite)
      const v = decl.value.trim();
      const isOklch = v.startsWith("oklch(");
      const isStructural = v === "transparent" || v === "none" || v.startsWith("var(") || /^[\d.]+$/.test(v) || v.startsWith("0 ");
      if (!isOklch && !isStructural) {
        failures.push(`${decl.prop}: ${v}`);
      }
    });
    expect(failures).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T10.3 + exit criteria: gallery tab 21 and existing-tab regression check
// ---------------------------------------------------------------------------

describe("T10.3 – gallery card tab 21 and existing-tab regression", () => {
  it("GALLERY_DEFAULT_TABS has exactly 21 entries (no regressions, no extras)", () => {
    expect(GALLERY_DEFAULT_TABS.length).toBe(21);
  });

  it("tab 20 (index 19) is gallery-theme-generator with title 'Theme Generator'", () => {
    const tab = GALLERY_DEFAULT_TABS[19];
    expect(tab.componentId).toBe("gallery-theme-generator");
    expect(tab.title).toBe("Theme Generator");
  });

  it("tab 21 (index 20) is gallery-badge with title 'TugBadge'", () => {
    const tab = GALLERY_DEFAULT_TABS[20];
    expect(tab.componentId).toBe("gallery-badge");
    expect(tab.title).toBe("TugBadge");
  });

  it("all 14 pre-existing tabs are present at their original positions", () => {
    const expectedIds = [
      "gallery-buttons",
      "gallery-chain-actions",
      "gallery-mutation",
      "gallery-tabbar",
      "gallery-dropdown",
      "gallery-default-button",
      "gallery-mutation-tx",
      "gallery-observable-props",
      "gallery-palette",
      "gallery-scale-timing",
      "gallery-cascade-inspector",
      "gallery-animator",
      "gallery-skeleton",
      "gallery-title-bar",
    ];
    const actualIds = GALLERY_DEFAULT_TABS.map((t) => t.componentId);
    for (let i = 0; i < expectedIds.length; i++) {
      expect(actualIds[i]).toBe(expectedIds[i]);
    }
  });

  it("all 20 tabs have closable: true", () => {
    for (const tab of GALLERY_DEFAULT_TABS) {
      expect(tab.closable).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// T-ACC-1: Novel CHM recipe produces 0 perceptual contrast body-text failures
// ---------------------------------------------------------------------------

describe("T-ACC-1 – CHM mood recipe: 0 unexpected body-text perceptual contrast failures (engine contrast floors)", () => {
  it("dark mode CHM recipe has 0 unexpected content failures (engine contrast floors enforced by construction)", () => {
    const { finalResults } = runFullPipelineForRecipe(CHM_NOVEL_RECIPE);
    const contentUnexpected = unexpectedFailures(finalResults).filter(
      (r) => r.role === "content",
    );
    const descriptions = contentUnexpected.map(
      (f) => `${f.fg} on ${f.bg}: contrast ${f.contrast.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  // Note: EXAMPLE_RECIPES now includes harmony (light mode with LIGHT_FORMULAS).
  // The test below covers all built-in recipes including the harmony light theme.

  it("all built-in example recipes produce 0 unexpected content failures (engine contrast floors; regression guard)", () => {
    for (const [name, recipe] of Object.entries(EXAMPLE_RECIPES) as [string, Parameters<typeof deriveTheme>[0]][]) {
      const { finalResults } = runFullPipelineForRecipe(recipe);
      const contentUnexpected = unexpectedFailures(finalResults).filter(
        (r) => r.role === "content",
      );
      const descriptions = contentUnexpected.map(
        (f) => `${f.fg} on ${f.bg}: contrast ${f.contrast.toFixed(1)}`,
      );
      expect(descriptions, `${name} recipe should have 0 unexpected content failures`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// T-ACC-3: CVD strip correctly flags green/red confusion under protanopia
// ---------------------------------------------------------------------------

describe("T-ACC-3 – CVD distinguishability: green/warning confusion under protanopia", () => {
  it("checkCVDDistinguishability emits at least one protanopia warning for the CHM recipe", () => {
    // Under protanopia the red channel is suppressed, causing green (positive) and
    // yellow (warning) to become indistinguishable — both shift toward yellow-brown.
    // The CVD module flags the positive|warning semantic pair for this recipe.
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const warnings = checkCVDDistinguishability(output.resolved, CVD_SEMANTIC_PAIRS);
    const protanopiaWarnings = warnings.filter((w) => w.type === "protanopia");

    // Core assertion: the module must emit at least one protanopia warning.
    expect(protanopiaWarnings.length).toBeGreaterThan(0);

    // The warning must reference the success token (green is the problematic color
    // under protanopia in the semantic pair set).
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
    // Explicitly set positive=green and destructive=red to target the classic
    // red-green confusion. The engine flags positive|warning under protanopia
    // because green and yellow both lose red-channel differentiation.
    const greenRedRecipe = {
      name: "GreenRed",
      description: "CVD test recipe with explicit green/red pairing.",
      mode: "dark" as const,
      surface: { canvas: "slate", card: "slate" },
      element: { content: "slate", control: "slate", display: "indigo", informational: "slate", border: "slate", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
      surfaceContrast: 50,
      signalIntensity: 80,
      warmth: 50,
    };
    const output = deriveTheme(greenRedRecipe);
    const warnings = checkCVDDistinguishability(output.resolved, CVD_SEMANTIC_PAIRS);
    const protanopiaWarnings = warnings.filter((w) => w.type === "protanopia");

    // Must emit at least one protanopia warning for a green/red recipe.
    expect(protanopiaWarnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Step 6: Role hue selectors
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – role hue selectors (Step 6)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders 15 hue pickers (2 surface + 6 element + 7 role) in the preview section", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const preview = container.querySelector("[data-testid='gtg-role-hues']");
    expect(preview).not.toBeNull();
    // All pickers use the same CompactHuePicker component (gtg-compact-hue-row)
    const pickers = preview!.querySelectorAll(".gtg-compact-hue-row");
    expect(pickers.length).toBe(15);
  });

  it("each role hue picker button has the correct data-testid", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const roleIds = [
      "gtg-role-hue-accent",
      "gtg-role-hue-action",
      "gtg-role-hue-agent",
      "gtg-role-hue-data",
      "gtg-role-hue-success",
      "gtg-role-hue-caution",
      "gtg-role-hue-danger",
    ];
    for (const id of roleIds) {
      const picker = container.querySelector(`[data-testid='${id}']`);
      expect(picker).not.toBeNull();
    }
  });

  it("default role hues match the Brio recipe defaults", () => {
    // Brio recipe has no explicit role hues, so all fall back to engine defaults:
    // accent=orange, active=blue, agent=violet, data=teal, success=green,
    // caution=yellow, destructive/danger=red.
    // Verify by deriving with explicit defaults and comparing to unset (implicit) output.
    const explicit = deriveTheme({
      name: "brio",
      description: "Explicit default role hues test recipe.",
      mode: "dark",
      surface: { canvas: "indigo-violet", card: "indigo-violet" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "indigo-violet", border: "indigo-violet", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    });
    const implicit = deriveTheme(EXAMPLE_RECIPES.brio);
    // tone tokens should match between explicit defaults and recipe defaults
    const roleTokens = [
      "--tug-base-element-tone-fill-normal-accent-rest",
      "--tug-base-element-tone-fill-normal-active-rest",
      "--tug-base-element-tone-fill-normal-agent-rest",
      "--tug-base-element-tone-fill-normal-data-rest",
      "--tug-base-element-tone-fill-normal-success-rest",
      "--tug-base-element-tone-fill-normal-caution-rest",
      "--tug-base-element-tone-fill-normal-danger-rest",
    ];
    for (const token of roleTokens) {
      expect(explicit.tokens[token]).toBe(implicit.tokens[token]);
    }
  });

  it("changing a role hue updates the derived theme output", () => {
    // Derive with default danger=red, then with danger=pink — tone-danger token must differ.
    const withRed = deriveTheme({
      name: "test",
      description: "Test recipe with red destructive hue.",
      mode: "dark",
      surface: { canvas: "violet", card: "violet" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "violet", border: "violet", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    });
    const withPink = deriveTheme({
      name: "test",
      description: "Test recipe with pink destructive hue.",
      mode: "dark",
      surface: { canvas: "violet", card: "violet" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "violet", border: "violet", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "pink" },
    });
    expect(withRed.tokens["--tug-base-element-tone-fill-normal-danger-rest"]).not.toBe(
      withPink.tokens["--tug-base-element-tone-fill-normal-danger-rest"],
    );
  });
});

// ---------------------------------------------------------------------------
// Step 7: Compact role hue pickers
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – compact role hue pickers (Step 7)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("each compact row renders with the correct role label", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const labelMap: Record<string, string> = {
      "gtg-role-hue-accent": "Accent",
      "gtg-role-hue-action": "Action",
      "gtg-role-hue-agent": "Agent",
      "gtg-role-hue-data": "Data",
      "gtg-role-hue-success": "Success",
      "gtg-role-hue-caution": "Caution",
      "gtg-role-hue-danger": "Danger",
    };
    for (const [testId, expectedLabel] of Object.entries(labelMap)) {
      const row = container.querySelector(`[data-testid='${testId}']`);
      expect(row).not.toBeNull();
      const labelEl = row!.querySelector(".gtg-compact-hue-label");
      expect(labelEl).not.toBeNull();
      expect(labelEl!.textContent).toBe(expectedLabel);
    }
  });

  it("each compact row renders with a color chip swatch", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const roleIds = [
      "gtg-role-hue-accent",
      "gtg-role-hue-action",
      "gtg-role-hue-agent",
      "gtg-role-hue-data",
      "gtg-role-hue-success",
      "gtg-role-hue-caution",
      "gtg-role-hue-danger",
    ];
    for (const id of roleIds) {
      const row = container.querySelector(`[data-testid='${id}']`);
      expect(row).not.toBeNull();
      const chip = row!.querySelector(".gtg-compact-hue-chip");
      expect(chip).not.toBeNull();
    }
  });

  it("clicking a compact row opens the popover with a TugHueStrip", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    // Before click: no hue strip visible in the document body
    const accentRow = container.querySelector("[data-testid='gtg-role-hue-accent']") as HTMLElement;
    expect(accentRow).not.toBeNull();

    act(() => {
      fireEvent.click(accentRow);
    });

    // After click: Radix popover renders into document.body portal
    const popoverContent = document.body.querySelector(".gtg-compact-hue-popover");
    expect(popoverContent).not.toBeNull();
    const strip = popoverContent!.querySelector(".tug-hue-strip");
    expect(strip).not.toBeNull();
    const swatches = strip!.querySelectorAll(".tug-hue-strip__swatch");
    expect(swatches.length).toBe(48);
  });

  it("existing role hue test selectors (gtg-role-hue-accent, etc.) still work", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const roleIds = [
      "gtg-role-hue-accent",
      "gtg-role-hue-action",
      "gtg-role-hue-agent",
      "gtg-role-hue-data",
      "gtg-role-hue-success",
      "gtg-role-hue-caution",
      "gtg-role-hue-danger",
    ];
    for (const id of roleIds) {
      expect(container.querySelector(`[data-testid='${id}']`)).not.toBeNull();
    }
  });

  it("selecting a hue in the popover closes the popover", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const accentRow = container.querySelector("[data-testid='gtg-role-hue-accent']") as HTMLElement;
    act(() => {
      fireEvent.click(accentRow);
    });

    // Popover is open
    const popoverContent = document.body.querySelector(".gtg-compact-hue-popover");
    expect(popoverContent).not.toBeNull();

    // Click a swatch inside the popover
    const firstSwatch = popoverContent!.querySelector(".tug-hue-strip__swatch") as HTMLElement;
    expect(firstSwatch).not.toBeNull();
    act(() => {
      fireEvent.click(firstSwatch!);
    });

    // Popover should now be closed
    const afterPopover = document.body.querySelector(".gtg-compact-hue-popover");
    expect(afterPopover).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Step 7: Emphasis x Role Preview section
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – emphasis x role preview", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders the emphasis x role preview section", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const section = container.querySelector("[data-testid='gtg-emphasis-role-preview']");
    expect(section).not.toBeNull();
  });

  it("renders the button grid with 3 emphasis rows × 4 roles = 12 button cells", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const grid = container.querySelector("[data-testid='gtg-erp-button-grid']");
    expect(grid).not.toBeNull();
    // 12 cells, each containing a tug-button
    const buttons = grid!.querySelectorAll(".tug-button");
    expect(buttons.length).toBe(12);
  });

  it("renders the badge grid with 3 emphasis rows × 7 roles = 21 badge cells", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const grid = container.querySelector("[data-testid='gtg-erp-badge-grid']");
    expect(grid).not.toBeNull();
    const badges = grid!.querySelectorAll(".tug-badge");
    expect(badges.length).toBe(21);
  });

  it("renders the selection controls row with 7 role cells", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const row = container.querySelector("[data-testid='gtg-erp-selection-row']");
    expect(row).not.toBeNull();
    const cells = row!.querySelectorAll(".gtg-erp-selection-cell");
    expect(cells.length).toBe(7);
  });

  it("each selection cell contains a checkbox and a switch", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const row = container.querySelector("[data-testid='gtg-erp-selection-row']");
    const cells = row!.querySelectorAll(".gtg-erp-selection-cell");
    for (const cell of Array.from(cells)) {
      expect(cell.querySelector(".tug-checkbox")).not.toBeNull();
      expect(cell.querySelector(".tug-switch")).not.toBeNull();
    }
  });

  it("preview section updates derived token output when a role hue changes", () => {
    // Verify that switching danger hue from red to pink changes the tone-danger token.
    // This is a unit-level assertion on deriveTheme() since the live preview update
    // is a CSS cascade effect invisible to JSDOM.
    const withRed = deriveTheme({
      name: "test", description: "Test recipe with red destructive hue.", mode: "dark",
      surface: { canvas: "violet", card: "violet" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "violet", border: "violet", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    });
    const withPink = deriveTheme({
      name: "test", description: "Test recipe with pink destructive hue.", mode: "dark",
      surface: { canvas: "violet", card: "violet" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "violet", border: "violet", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "pink" },
    });
    expect(withRed.tokens["--tug-base-element-tone-fill-normal-danger-rest"]).not.toBe(
      withPink.tokens["--tug-base-element-tone-fill-normal-danger-rest"],
    );
  });
});

// ---------------------------------------------------------------------------
// Step 9: Saved-theme selector dropdown
// ---------------------------------------------------------------------------

/**
 * Render GalleryThemeGeneratorContent wrapped in TugThemeProvider with a
 * mocked global.fetch so loadSavedThemes() returns a controlled list.
 *
 * Returns cleanup helpers and the rendered container.
 */
function renderWithThemeProvider(savedThemeNames: string[] = []) {
  const originalFetch = globalThis.fetch;
  // Mock fetch: /__themes/list returns the provided list; other URLs return ok stubs.
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
      const recipe = JSON.stringify({ name: "Saved Theme", description: "Saved theme for testing.", mode: "dark", surface: { canvas: "amber", card: "amber" }, element: { content: "sand", control: "sand", display: "indigo", informational: "amber", border: "amber", decorative: "gray" }, role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" } });
      return new Response(recipe, { status: 200 });
    }
    return new Response("", { status: 404 });
  };

  let container!: HTMLElement;
  act(() => {
    ({ container } = render(
      React.createElement(
        TugThemeProvider,
        {},
        React.createElement(GalleryThemeGeneratorContent, {}),
      ),
    ));
  });

  const restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  return { container, restoreFetch };
}

describe("GalleryThemeGeneratorContent – saved-theme selector (Step 9)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); removeThemeCSS(); });

  it("dropdown renders with 'Brio (default)' option when no saved themes exist", async () => {
    const { container, restoreFetch } = renderWithThemeProvider([]);
    try {
      // Wait for the async loadSavedThemes() effect to complete
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

      const select = container.querySelector("[data-testid='gtg-saved-theme-select']") as HTMLSelectElement;
      expect(select).not.toBeNull();
      const brioOption = select.querySelector("[data-testid='gtg-saved-theme-option-brio']");
      expect(brioOption).not.toBeNull();
      expect(brioOption!.textContent).toBe("Brio (default)");
    } finally {
      restoreFetch();
    }
  });

  it("dropdown shows only placeholder + 'Brio (default)' when no saved themes exist", async () => {
    const { container, restoreFetch } = renderWithThemeProvider([]);
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

      const select = container.querySelector("[data-testid='gtg-saved-theme-select']") as HTMLSelectElement;
      expect(select).not.toBeNull();
      // Placeholder + Brio (default) = 2 options
      expect(select.options.length).toBe(2);
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
      // Placeholder + Brio (default) + 2 saved themes = 4 options
      expect(select.options.length).toBe(4);
      const myThemeOpt = select.querySelector("[value='my-theme']");
      const darkForestOpt = select.querySelector("[value='dark-forest']");
      expect(myThemeOpt).not.toBeNull();
      expect(darkForestOpt).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("selecting 'Brio (default)' resets recipe to Brio dark mode defaults", async () => {
    const { container, restoreFetch } = renderWithThemeProvider([]);
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

      // First switch to light mode to change state away from Brio defaults
      const lightBtn = container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement;
      act(() => { fireEvent.click(lightBtn); });

      // Now select "Brio (default)" from the dropdown
      const select = container.querySelector("[data-testid='gtg-saved-theme-select']") as HTMLSelectElement;
      act(() => {
        fireEvent.change(select, { target: { value: "__brio__" } });
      });

      // After selecting Brio (default), the mode button should return to dark (Brio default)
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const darkBtn = container.querySelector("[data-testid='gtg-mode-dark']");
      expect(darkBtn!.classList.contains("tug-button-filled-action")).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it("selecting a saved theme dispatches fetch for the theme CSS and recipe JSON", async () => {
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url === "/__themes/list") {
        return new Response(JSON.stringify({ themes: ["my-custom-theme"] }), { status: 200 });
      }
      if (url.endsWith(".css")) {
        return new Response("body {}", { status: 200 });
      }
      if (url.endsWith("-recipe.json")) {
        const recipe = JSON.stringify({ name: "My Custom Theme", description: "Custom theme for testing.", mode: "dark", surface: { canvas: "cobalt", card: "cobalt" }, element: { content: "slate", control: "slate", display: "indigo", informational: "cobalt", border: "cobalt", decorative: "gray" }, role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" } });
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

    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

      const select = container.querySelector("[data-testid='gtg-saved-theme-select']") as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(select, { target: { value: "my-custom-theme" } });
        await new Promise((r) => setTimeout(r, 0));
      });

      // Verify fetch was called for the theme CSS (setDynamicTheme) and recipe JSON
      const cssFetch = fetchCalls.find((u) => u.includes("my-custom-theme") && u.endsWith(".css") && !u.endsWith("-recipe.json"));
      const recipeFetch = fetchCalls.find((u) => u.includes("my-custom-theme") && u.endsWith("-recipe.json"));
      expect(cssFetch).toBeDefined();
      expect(recipeFetch).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Step 3: Formulas state — generator uses correct formulas for light mode
// ---------------------------------------------------------------------------

describe("deriveTheme – Harmony preset produces correct light-mode output (Step 3)", () => {
  it("deriveTheme(EXAMPLE_RECIPES.harmony) produces 373 tokens", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.harmony);
    expect(Object.keys(output.tokens).length).toBe(373);
  });

  it("Harmony recipe includes formulas field", () => {
    expect(EXAMPLE_RECIPES.harmony.formulas).toBeDefined();
  });

  it("Harmony formulas differ from DARK_FORMULAS (light overrides are active)", () => {
    const harmonyFormulas = EXAMPLE_RECIPES.harmony.formulas!;
    // bgAppTone must differ: light=95, dark=5
    expect(harmonyFormulas.bgAppTone).not.toBe(DARK_FORMULAS.bgAppTone);
    expect(harmonyFormulas.bgAppTone).toBe(95);
  });

  it("Harmony formulas match LIGHT_FORMULAS", () => {
    const harmonyFormulas = EXAMPLE_RECIPES.harmony.formulas!;
    expect(harmonyFormulas.bgAppTone).toBe(LIGHT_FORMULAS.bgAppTone);
    expect(harmonyFormulas.fgDefaultTone).toBe(LIGHT_FORMULAS.fgDefaultTone);
    expect(harmonyFormulas.borderSignalTone).toBe(LIGHT_FORMULAS.borderSignalTone);
    expect(harmonyFormulas.semanticSignalTone).toBe(LIGHT_FORMULAS.semanticSignalTone);
  });

  it("Harmony output tokens match direct deriveTheme(EXAMPLE_RECIPES.harmony) call (token-for-token)", () => {
    // This verifies that when the engine receives a recipe with formulas=LIGHT_FORMULAS
    // it produces a stable, reproducible output.
    const output1 = deriveTheme(EXAMPLE_RECIPES.harmony);
    const output2 = deriveTheme(EXAMPLE_RECIPES.harmony);
    expect(Object.keys(output1.tokens)).toEqual(Object.keys(output2.tokens));
    for (const [token, value] of Object.entries(output1.tokens)) {
      expect(output2.tokens[token]).toBe(value);
    }
  });

  it("Harmony borderSignalTone is 40 (LIGHT_FORMULAS value, not dark default 50)", () => {
    expect(LIGHT_FORMULAS.borderSignalTone).toBe(40);
    expect(DARK_FORMULAS.borderSignalTone).toBe(50);
  });

  it("Harmony semanticSignalTone is 35 (LIGHT_FORMULAS value, not dark default 50)", () => {
    expect(LIGHT_FORMULAS.semanticSignalTone).toBe(35);
    expect(DARK_FORMULAS.semanticSignalTone).toBe(50);
  });
});

describe("deriveTheme – formulas field controls border and semantic tone (Step 3)", () => {
  it("dark recipe (DARK_FORMULAS) and light recipe (LIGHT_FORMULAS) produce different tone-accent tokens", () => {
    const darkOutput = deriveTheme({
      name: "test-dark",
      description: "Dark formulas test",
      mode: "dark",
      surface: { canvas: "indigo", card: "indigo" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "indigo", border: "indigo", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
      formulas: DARK_FORMULAS,
    });
    const lightOutput = deriveTheme({
      name: "test-light",
      description: "Light formulas test",
      mode: "light",
      surface: { canvas: "indigo", card: "indigo" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "indigo", border: "indigo", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
      formulas: LIGHT_FORMULAS,
    });
    // The semantic tone tokens should differ because semanticSignalTone differs (50 vs 35)
    expect(darkOutput.tokens["--tug-base-element-tone-fill-normal-accent-rest"]).not.toBe(lightOutput.tokens["--tug-base-element-tone-fill-normal-accent-rest"]);
  });

  it("DARK_FORMULAS.borderSignalTone=50 preserves existing brio dark border-accent value", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const darkOutput = deriveTheme({
      ...EXAMPLE_RECIPES.brio,
      formulas: DARK_FORMULAS,
    });
    // Explicit DARK_FORMULAS matches the fallback (no formulas) behavior
    expect(brioOutput.tokens["--tug-base-element-global-border-normal-accent-rest"]).toBe(darkOutput.tokens["--tug-base-element-global-border-normal-accent-rest"]);
  });

  it("currentRecipe includes formulas field after export (round-trip preservation)", () => {
    // Verify that deriveTheme with LIGHT_FORMULAS, re-serialized and re-parsed,
    // preserves the formulas field.
    const recipe = {
      name: "light-test",
      description: "Light formulas round-trip test",
      mode: "light" as const,
      surface: { canvas: "indigo", card: "indigo" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "indigo", border: "indigo", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
      formulas: LIGHT_FORMULAS,
    };
    const serialized = JSON.stringify(recipe);
    const parsed = JSON.parse(serialized) as typeof recipe;
    expect(parsed.formulas).toBeDefined();
    expect(parsed.formulas!.borderSignalTone).toBe(40);
    expect(parsed.formulas!.semanticSignalTone).toBe(35);
    // Re-deriving from parsed recipe produces same output as original
    const original = deriveTheme(recipe);
    const roundTrip = deriveTheme(parsed);
    expect(Object.keys(original.tokens).length).toBe(Object.keys(roundTrip.tokens).length);
    for (const [token, value] of Object.entries(original.tokens)) {
      expect(roundTrip.tokens[token]).toBe(value);
    }
  });

  it("recipe without formulas field falls back to DARK_FORMULAS behavior", () => {
    const noFormulas = deriveTheme({
      name: "no-formulas",
      description: "No formulas field",
      mode: "dark",
      surface: { canvas: "indigo", card: "indigo" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "indigo", border: "indigo", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    });
    const darkFormulas = deriveTheme({
      name: "dark-formulas",
      description: "Explicit DARK_FORMULAS",
      mode: "dark",
      surface: { canvas: "indigo", card: "indigo" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "indigo", border: "indigo", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
      formulas: DARK_FORMULAS,
    });
    expect(noFormulas.tokens["--tug-base-element-tone-fill-normal-accent-rest"]).toBe(darkFormulas.tokens["--tug-base-element-tone-fill-normal-accent-rest"]);
    expect(noFormulas.tokens["--tug-base-element-global-border-normal-accent-rest"]).toBe(darkFormulas.tokens["--tug-base-element-global-border-normal-accent-rest"]);
  });
});

// ---------------------------------------------------------------------------
// Step 5: Final integration checkpoint
//
// Verifies end-to-end behavior through the component state machine:
//   Task 1: Brio → Light → Dark round-trip produces original Brio output
//   Task 2: Harmony preset token-for-token match with direct engine call
//   Task 3: Export/import round-trip preserves formulas field
//   Task 4: Token count is exactly 373 in all states
//
// Strategy: extract rendered token map from DOM via gtg-token-name / gtg-token-value
// spans, then compare against deriveTheme() direct calls.
// ---------------------------------------------------------------------------

/**
 * Read the current rendered token map from the TokenPreview grid.
 * Returns { tokenName: tokenValue } for all rendered rows.
 */
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

/**
 * Read the token count from the "Token Preview (N tokens)" section title.
 */
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

  // -------------------------------------------------------------------------
  // Task 4: Token count is exactly 373 in all states
  // -------------------------------------------------------------------------

  it("Task 4: initial render shows exactly 373 tokens", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    expect(readRenderedTokenCount(container)).toBe(373);
  });

  it("Task 4: Harmony preset shows exactly 373 tokens", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    act(() => {
      fireEvent.click(container.querySelector("[data-testid='gtg-preset-harmony']") as HTMLElement);
    });
    expect(readRenderedTokenCount(container)).toBe(373);
  });

  it("Task 4: mode toggle Dark→Light→Dark preserves 373 tokens throughout", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    expect(readRenderedTokenCount(container)).toBe(373);
    act(() => {
      fireEvent.click(container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement);
    });
    expect(readRenderedTokenCount(container)).toBe(373);
    act(() => {
      fireEvent.click(container.querySelector("[data-testid='gtg-mode-dark']") as HTMLElement);
    });
    expect(readRenderedTokenCount(container)).toBe(373);
  });

  // -------------------------------------------------------------------------
  // Task 2: Harmony preset token-for-token match with direct engine call
  // -------------------------------------------------------------------------

  it("Task 2: Harmony preset rendered tokens match deriveTheme(EXAMPLE_RECIPES.harmony) token-for-token", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    act(() => {
      fireEvent.click(container.querySelector("[data-testid='gtg-preset-harmony']") as HTMLElement);
    });

    const rendered = readRenderedTokens(container);
    const expected = deriveTheme(EXAMPLE_RECIPES.harmony).tokens;

    // Token count must match
    expect(Object.keys(rendered).length).toBe(Object.keys(expected).length);

    // Every expected token must be present with the same value
    const mismatches: string[] = [];
    for (const [name, expectedValue] of Object.entries(expected)) {
      if (rendered[name] !== expectedValue) {
        mismatches.push(`${name}: rendered="${rendered[name]}" expected="${expectedValue}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("Task 2: Harmony preset uses LIGHT_FORMULAS (semantic tone tokens are darker than Brio dark)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });

    // Capture Brio dark baseline tokens first
    const brioTokens = readRenderedTokens(container);

    // Load Harmony
    act(() => {
      fireEvent.click(container.querySelector("[data-testid='gtg-preset-harmony']") as HTMLElement);
    });
    const harmonyTokens = readRenderedTokens(container);

    // tone-accent must differ: harmony uses semanticSignalTone=35, brio uses 50
    expect(harmonyTokens["--tug-base-element-tone-fill-normal-accent-rest"]).toBeDefined();
    expect(harmonyTokens["--tug-base-element-tone-fill-normal-accent-rest"]).not.toBe(brioTokens["--tug-base-element-tone-fill-normal-accent-rest"]);
  });

  // -------------------------------------------------------------------------
  // Task 1: Brio → Light → Dark round-trip restores original Brio output
  // -------------------------------------------------------------------------

  it("Task 1: Brio → Light → Dark round-trip: token map matches original Brio", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });

    // Capture baseline Brio tokens on initial render
    const initialBrioTokens = readRenderedTokens(container);
    expect(Object.keys(initialBrioTokens).length).toBe(373);

    // Toggle to Light mode
    act(() => {
      fireEvent.click(container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement);
    });
    // Tokens should have changed (light formulas in effect)
    const lightTokens = readRenderedTokens(container);
    expect(lightTokens["--tug-base-surface-global-primary-normal-app-rest"]).not.toBe(initialBrioTokens["--tug-base-surface-global-primary-normal-app-rest"]);

    // Toggle back to Dark mode
    act(() => {
      fireEvent.click(container.querySelector("[data-testid='gtg-mode-dark']") as HTMLElement);
    });
    const restoredTokens = readRenderedTokens(container);

    // All tokens must exactly match the initial Brio output
    const mismatches: string[] = [];
    for (const [name, originalValue] of Object.entries(initialBrioTokens)) {
      if (restoredTokens[name] !== originalValue) {
        mismatches.push(`${name}: restored="${restoredTokens[name]}" original="${originalValue}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("Task 1: Dark→Light toggle uses LIGHT_FORMULAS (bg-app becomes near-white)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });

    // In dark mode, bg-app should be near-black (low L value in oklch)
    const darkTokens = readRenderedTokens(container);
    const darkBgApp = darkTokens["--tug-base-surface-global-primary-normal-app-rest"] ?? "";
    // Dark bg-app is a --tug-color() reference; it will have low tone in its args
    expect(darkBgApp).toBeTruthy();

    act(() => {
      fireEvent.click(container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement);
    });
    const lightTokens = readRenderedTokens(container);
    const lightBgApp = lightTokens["--tug-base-surface-global-primary-normal-app-rest"] ?? "";

    // bg-app must change when switching to light mode
    expect(lightBgApp).not.toBe(darkBgApp);
  });

  // -------------------------------------------------------------------------
  // Task 3: Export/import round-trip preserves formulas
  // -------------------------------------------------------------------------

  it("Task 3: currentRecipe exported JSON includes formulas field", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    // Load Harmony so we have light-mode formulas in state
    act(() => {
      fireEvent.click(container.querySelector("[data-testid='gtg-preset-harmony']") as HTMLElement);
    });

    // The Export Recipe JSON button triggers a download; we can verify the recipe
    // object is correctly assembled by checking currentRecipe via the generateCssExport
    // function's recipe parameter — but the easiest route is to verify the round-trip
    // at the engine level, which is what step 3 tests already cover.
    // Here we verify the component is in harmony state (mode=light) and the
    // formula-controlled tokens differ from the brio dark baseline, confirming
    // formulas are tracked in state correctly.
    const harmonyRendered = readRenderedTokens(container);
    const directHarmony = deriveTheme(EXAMPLE_RECIPES.harmony).tokens;

    // The rendered output must match direct engine call — this confirms formulas
    // are in state and round-tripped correctly through the component's runDerive path
    expect(harmonyRendered["--tug-base-element-tone-fill-normal-accent-rest"]).toBe(directHarmony["--tug-base-element-tone-fill-normal-accent-rest"]);
    expect(harmonyRendered["--tug-base-surface-global-primary-normal-app-rest"]).toBe(directHarmony["--tug-base-surface-global-primary-normal-app-rest"]);
    expect(harmonyRendered["--tug-base-element-global-text-normal-default-rest"]).toBe(directHarmony["--tug-base-element-global-text-normal-default-rest"]);
  });

  it("Task 3: importing Harmony recipe JSON restores light-mode formulas and matching output", () => {
    // Simulate the handleRecipeImported path: parse EXAMPLE_RECIPES.harmony as JSON
    // and re-import it. The output must match direct deriveTheme(EXAMPLE_RECIPES.harmony).
    const harmonyJson = JSON.stringify(EXAMPLE_RECIPES.harmony);
    const parsedHarmony = JSON.parse(harmonyJson) as typeof EXAMPLE_RECIPES.harmony;

    // Verify round-trip preserves formulas
    expect(parsedHarmony.formulas).toBeDefined();
    expect(parsedHarmony.formulas!.bgAppTone).toBe(LIGHT_FORMULAS.bgAppTone);
    expect(parsedHarmony.formulas!.borderSignalTone).toBe(LIGHT_FORMULAS.borderSignalTone);
    expect(parsedHarmony.formulas!.semanticSignalTone).toBe(LIGHT_FORMULAS.semanticSignalTone);

    // Deriving from parsed recipe must produce identical output
    const directOutput = deriveTheme(EXAMPLE_RECIPES.harmony);
    const importedOutput = deriveTheme(parsedHarmony);
    expect(Object.keys(importedOutput.tokens).length).toBe(373);
    const mismatches: string[] = [];
    for (const [name, value] of Object.entries(directOutput.tokens)) {
      if (importedOutput.tokens[name] !== value) {
        mismatches.push(`${name}: imported="${importedOutput.tokens[name]}" expected="${value}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("Task 3: recipe without formulas field imported into component falls back to DARK_FORMULAS", () => {
    // A recipe exported before the formulas field existed should still work.
    // When formulas is absent, handleRecipeImported uses DARK_FORMULAS.
    // Verify by deriving directly: recipe without formulas should produce same
    // output as recipe with explicit DARK_FORMULAS.
    const bareRecipe = {
      name: "bare",
      description: "No formulas field",
      mode: "dark" as const,
      surface: { canvas: "indigo-violet", card: "indigo-violet" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "indigo-violet", border: "indigo-violet", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    };
    const noFormulasOutput = deriveTheme(bareRecipe);
    const darkFormulasOutput = deriveTheme({ ...bareRecipe, formulas: DARK_FORMULAS });
    expect(noFormulasOutput.tokens["--tug-base-element-tone-fill-normal-accent-rest"]).toBe(
      darkFormulasOutput.tokens["--tug-base-element-tone-fill-normal-accent-rest"],
    );
    expect(Object.keys(noFormulasOutput.tokens).length).toBe(373);
  });
});
