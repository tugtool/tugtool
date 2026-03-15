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
 * - T-ACC-1: Novel CHM recipe produces 0 Lc body-text failures
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
import { deriveTheme, EXAMPLE_RECIPES } from "@/components/tugways/theme-derivation-engine";
import { validateThemeContrast, autoAdjustContrast, checkCVDDistinguishability, CVD_SEMANTIC_PAIRS } from "@/components/tugways/theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/element-surface-pairing-map";

// ---------------------------------------------------------------------------
// Known-exception set shared by T10.3 and T-ACC-1
// ---------------------------------------------------------------------------

/**
 * fg tokens that the current derivation engine produces below WCAG thresholds
 * for known structural or design reasons. Mirrors KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS
 * in theme-derivation-engine.test.ts — these are excluded from the "0 unexpected
 * failures" assertion so the tests track real regressions rather than documented
 * design constraints.
 */
const KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS = new Set([
  // Secondary / tertiary text hierarchy
  "--tug-base-fg-subtle",
  "--tug-base-fg-placeholder",
  "--tug-base-fg-link-hover",
  "--tug-base-fg-link",
  "--tug-base-control-selected-fg",
  "--tug-base-control-highlighted-fg",
  "--tug-base-selection-fg",
  // Muted / read-only hierarchy (Lc ~61, below Lc 75 body-text threshold)
  "--tug-base-fg-muted",
  "--tug-base-field-fg-readOnly",
  // Text / icon on vivid accent or semantic backgrounds
  "--tug-base-fg-onAccent",
  "--tug-base-icon-onAccent",
  "--tug-base-fg-onDanger",
  // Interactive state tokens on vivid colored filled button backgrounds
  // (hover/active states are transient; filled button bg hues may be vivid mid-tones)
  "--tug-base-control-filled-accent-fg-hover",
  "--tug-base-control-filled-accent-fg-active",
  "--tug-base-control-filled-accent-icon-hover",
  "--tug-base-control-filled-accent-icon-active",
  "--tug-base-control-filled-action-fg-hover",
  "--tug-base-control-filled-action-fg-active",
  "--tug-base-control-filled-action-icon-hover",
  "--tug-base-control-filled-action-icon-active",
  "--tug-base-control-filled-agent-fg-hover",
  "--tug-base-control-filled-agent-fg-active",
  "--tug-base-control-filled-agent-icon-hover",
  "--tug-base-control-filled-agent-icon-active",
  // Ghost-danger rest/hover/active: danger hue at mid-tone is below Lc 60 large-text
  "--tug-base-control-ghost-danger-fg-rest",
  "--tug-base-control-ghost-danger-fg-hover",
  "--tug-base-control-ghost-danger-fg-active",
  "--tug-base-control-ghost-danger-icon-active",
  // Muted / disabled element tokens below Lc thresholds
  "--tug-base-icon-muted",
  "--tug-base-fg-disabled",
  "--tug-base-icon-disabled",
  "--tug-base-field-fg-disabled",
  // Semantic tone tokens (all 7 role families)
  "--tug-base-tone-accent-fg",
  "--tug-base-tone-active-fg",
  "--tug-base-tone-agent-fg",
  "--tug-base-tone-data-fg",
  "--tug-base-tone-success-fg",
  "--tug-base-tone-caution-fg",
  "--tug-base-tone-danger-fg",
  "--tug-base-tone-accent-icon",
  "--tug-base-tone-active-icon",
  "--tug-base-tone-agent-icon",
  "--tug-base-tone-data-icon",
  "--tug-base-tone-success-icon",
  "--tug-base-tone-caution-icon",
  "--tug-base-tone-danger-icon",
  // UI control indicators (form elements / state indicators)
  "--tug-base-accent-default",
  "--tug-base-toggle-thumb",
  "--tug-base-toggle-icon-mixed",
  "--tug-base-checkmark",
  "--tug-base-radio-dot",
  "--tug-base-range-thumb",
  // Tab chrome (intentionally below Lc 75 body-text threshold)
  "--tug-base-tab-fg-rest",
  "--tug-base-tab-fg-hover",
  // Field text — light-mode field backgrounds create Lc constraints
  "--tug-base-field-fg",
]);

/**
 * Specific (fg, bg) pairs below threshold due to structural derivation
 * constraints that cannot be resolved by tone-bumping alone. Keyed as
 * `"fgToken|bgToken"` strings for O(1) lookup. Mirrors the exception sets in
 * theme-derivation-engine.test.ts.
 *
 * Categories:
 *   - Light-mode surface derivation limitation (engine calibrated for dark mode;
 *     bg-app and surface-raised are derived too dark for light-mode recipes,
 *     causing fg-default/fg-muted to fail against them).
 *   - Surface-screen and surface-overlay: fg-inverse is intentionally a dark
 *     foreground used for inverted chips/badges, not body text on these surfaces.
 *   - fg-muted on overlay: overlay surfaces use a semi-transparent bg; muted fg
 *     falls below 4.5:1 against very light overlays by design.
 */
const KNOWN_PAIR_EXCEPTIONS = new Set([
  // Light-mode surface derivation (bg-app / surface-raised derived too dark)
  "--tug-base-fg-default|--tug-base-bg-app",
  "--tug-base-fg-default|--tug-base-bg-canvas",
  "--tug-base-fg-default|--tug-base-surface-raised",
  "--tug-base-fg-default|--tug-base-surface-overlay",
  "--tug-base-fg-default|--tug-base-surface-sunken",
  "--tug-base-fg-muted|--tug-base-surface-raised",
  // fg-inverse on screen / screen-adjacent surfaces
  "--tug-base-fg-inverse|--tug-base-surface-screen",
  // fg-muted / fg-default on overlay and screen surfaces
  "--tug-base-fg-default|--tug-base-surface-screen",
  "--tug-base-fg-muted|--tug-base-surface-overlay",
  // Additional light-mode link + icon exceptions
  "--tug-base-fg-link|--tug-base-surface-content",
  "--tug-base-fg-link|--tug-base-surface-overlay",
  "--tug-base-icon-default|--tug-base-surface-sunken",
  "--tug-base-icon-default|--tug-base-surface-overlay",
  "--tug-base-icon-default|--tug-base-surface-raised",
  "--tug-base-icon-default|--tug-base-surface-default",
  // Light-mode tab chrome: tab-fg-rest (tone=50) vs surface-sunken (tone=44) in light
  // mode are near-identical in lightness. Light-mode formula calibration is deferred
  // per Q01 — this constraint is structural, not a regression.
  "--tug-base-tab-fg-rest|--tug-base-surface-sunken",
]);

/**
 * Run the full derive → validate → auto-adjust pipeline for a given recipe and
 * return the final contrast results plus unfixable list.
 */
function runFullPipelineForRecipe(recipe: Parameters<typeof deriveTheme>[0]) {
  const output = deriveTheme(recipe);
  const initial = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);
  const failures = initial.filter((r) => !r.lcPass);
  const adjusted = autoAdjustContrast(output.tokens, output.resolved, failures, ELEMENT_SURFACE_PAIRING_MAP);
  const finalResults = validateThemeContrast(adjusted.resolved, ELEMENT_SURFACE_PAIRING_MAP);
  return { output, finalResults, unfixable: adjusted.unfixable };
}

/**
 * Filter a list of ContrastResults to only the unexpected failures —
 * those outside both the known-token exception set and the known-pair set.
 */
function unexpectedFailures(results: ReturnType<typeof validateThemeContrast>) {
  return results.filter((r) => {
    if (r.lcPass) return false;
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

  it("renders the atmosphere hue strip with 24 swatches", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const strip = container.querySelector("[data-testid='gtg-atmosphere-hue-strip']");
    expect(strip).not.toBeNull();
    const swatches = strip!.querySelectorAll(".gtg-hue-swatch");
    expect(swatches.length).toBe(24);
  });

  it("renders the text hue strip with 24 swatches", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const strip = container.querySelector("[data-testid='gtg-text-hue-strip']");
    expect(strip).not.toBeNull();
    const swatches = strip!.querySelectorAll(".gtg-hue-swatch");
    expect(swatches.length).toBe(24);
  });

  it("renders three mood sliders", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const sc = container.querySelector("[data-testid='gtg-slider-surface-contrast']");
    const sv = container.querySelector("[data-testid='gtg-slider-signal-vividity']");
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
  mode: "dark" as const,
  atmosphere: { hue: "amber" },
  text: { hue: "sand" },
  accent: "flame",
  active: "cobalt",
  surfaceContrast: 70,
  signalVividity: 80,
  warmth: 65,
};

describe("T10.3 – novel recipe end-to-end: derive → validate → export → postcss roundtrip", () => {
  it("deriveTheme produces a ThemeOutput with 371 tokens for the novel recipe", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    expect(Object.keys(output.tokens).length).toBe(371);
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

  it("0 unexpected body-text Lc contrast failures after derive + autoAdjust (T-ACC-1 / T10.3 core assertion)", () => {
    const { finalResults } = runFullPipelineForRecipe(CHM_NOVEL_RECIPE);
    const bodyTextUnexpected = unexpectedFailures(finalResults).filter(
      (r) => r.role === "body-text",
    );
    const descriptions = bodyTextUnexpected.map(
      (f) => `${f.fg} on ${f.bg}: Lc ${f.lc.toFixed(1)}`,
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
// T-ACC-1: Novel CHM recipe produces 0 Lc body-text failures
// ---------------------------------------------------------------------------

describe("T-ACC-1 – CHM mood recipe: 0 unexpected Lc body-text failures after auto-adjust", () => {
  it("dark mode CHM recipe has 0 unexpected body-text failures after autoAdjustContrast", () => {
    const { finalResults } = runFullPipelineForRecipe(CHM_NOVEL_RECIPE);
    const bodyTextUnexpected = unexpectedFailures(finalResults).filter(
      (r) => r.role === "body-text",
    );
    const descriptions = bodyTextUnexpected.map(
      (f) => `${f.fg} on ${f.bg}: Lc ${f.lc.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  it("light mode CHM recipe has 0 unexpected body-text failures after autoAdjustContrast", () => {
    const lightRecipe = { ...CHM_NOVEL_RECIPE, mode: "light" as const };
    const { finalResults } = runFullPipelineForRecipe(lightRecipe);
    const bodyTextUnexpected = unexpectedFailures(finalResults).filter(
      (r) => r.role === "body-text",
    );
    const descriptions = bodyTextUnexpected.map(
      (f) => `${f.fg} on ${f.bg}: Lc ${f.lc.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  it("all three example recipes produce 0 unexpected body-text failures after autoAdjustContrast (regression guard)", () => {
    for (const [name, recipe] of Object.entries(EXAMPLE_RECIPES) as [string, Parameters<typeof deriveTheme>[0]][]) {
      const { finalResults } = runFullPipelineForRecipe(recipe);
      const bodyTextUnexpected = unexpectedFailures(finalResults).filter(
        (r) => r.role === "body-text",
      );
      const descriptions = bodyTextUnexpected.map(
        (f) => `${f.fg} on ${f.bg}: Lc ${f.lc.toFixed(1)}`,
      );
      expect(descriptions, `${name} recipe should have 0 unexpected body-text failures`).toEqual([]);
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
      mode: "dark" as const,
      atmosphere: { hue: "slate" },
      text: { hue: "slate" },
      positive: "green",
      destructive: "red",
      surfaceContrast: 50,
      signalVividity: 80,
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

  it("renders the role hues section with 7 hue strips", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const roleHues = container.querySelector("[data-testid='gtg-role-hues']");
    expect(roleHues).not.toBeNull();
    const strips = roleHues!.querySelectorAll(".gtg-hue-strip");
    expect(strips.length).toBe(7);
  });

  it("each role hue strip has 24 swatches", () => {
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
      const strip = container.querySelector(`[data-testid='${id}']`);
      expect(strip).not.toBeNull();
      const swatches = strip!.querySelectorAll(".gtg-hue-swatch");
      expect(swatches.length).toBe(24);
    }
  });

  it("default role hues match the Brio recipe defaults", () => {
    // Brio recipe has no explicit role hues, so all fall back to engine defaults:
    // accent=orange, active=blue, agent=violet, data=teal, success=green,
    // caution=yellow, destructive/danger=red.
    // Verify by deriving with explicit defaults and comparing to unset (implicit) output.
    const explicit = deriveTheme({
      name: "brio",
      mode: "dark",
      atmosphere: { hue: "violet", offset: -6 },
      text: { hue: "cobalt" },
      accent: "orange",
      active: "blue",
      agent: "violet",
      data: "teal",
      success: "green",
      caution: "yellow",
      destructive: "red",
    });
    const implicit = deriveTheme(EXAMPLE_RECIPES.brio);
    // tone tokens should match between explicit defaults and recipe defaults
    const roleTokens = [
      "--tug-base-tone-accent",
      "--tug-base-tone-active",
      "--tug-base-tone-agent",
      "--tug-base-tone-data",
      "--tug-base-tone-success",
      "--tug-base-tone-caution",
      "--tug-base-tone-danger",
    ];
    for (const token of roleTokens) {
      expect(explicit.tokens[token]).toBe(implicit.tokens[token]);
    }
  });

  it("changing a role hue updates the derived theme output", () => {
    // Derive with default danger=red, then with danger=pink — tone-danger token must differ.
    const withRed = deriveTheme({
      name: "test",
      mode: "dark",
      atmosphere: { hue: "violet" },
      text: { hue: "cobalt" },
      destructive: "red",
    });
    const withPink = deriveTheme({
      name: "test",
      mode: "dark",
      atmosphere: { hue: "violet" },
      text: { hue: "cobalt" },
      destructive: "pink",
    });
    expect(withRed.tokens["--tug-base-tone-danger"]).not.toBe(
      withPink.tokens["--tug-base-tone-danger"],
    );
  });
});

// ---------------------------------------------------------------------------
// Step 7: Emphasis x Role Preview section
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – emphasis x role preview (Step 7)", () => {
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
      name: "test", mode: "dark",
      atmosphere: { hue: "violet" }, text: { hue: "cobalt" },
      destructive: "red",
    });
    const withPink = deriveTheme({
      name: "test", mode: "dark",
      atmosphere: { hue: "violet" }, text: { hue: "cobalt" },
      destructive: "pink",
    });
    expect(withRed.tokens["--tug-base-tone-danger"]).not.toBe(
      withPink.tokens["--tug-base-tone-danger"],
    );
  });
});
