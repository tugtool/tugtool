/**
 * contrast-dashboard tests — Step 7.
 *
 * Tests cover:
 * - T7.1: Dashboard renders correct number of pairs from pairing map
 * - T7.2: Brio recipe shows all non-intentional body-text pairs as passing
 * - T7.3: Summary bar count matches actual pass/fail results
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { GalleryThemeGeneratorContent } from "@/components/tugways/cards/gallery-theme-generator-content";
import { FG_BG_PAIRING_MAP } from "@/components/tugways/fg-bg-pairing-map";
import { validateThemeContrast } from "@/components/tugways/theme-accessibility";
import { deriveTheme, EXAMPLE_RECIPES } from "@/components/tugways/theme-derivation-engine";
import { _resetForTest } from "@/card-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDashboard() {
  let container!: HTMLElement;
  act(() => {
    ({ container } = render(<GalleryThemeGeneratorContent />));
  });
  return container;
}

// ---------------------------------------------------------------------------
// T7.1: Dashboard renders correct number of pairs from pairing map
// ---------------------------------------------------------------------------

describe("contrast-dashboard – T7.1: renders correct number of pairs", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders the contrast dashboard section", () => {
    const container = renderDashboard();
    expect(container.querySelector("[data-testid='gtg-contrast-dashboard']")).not.toBeNull();
  });

  it("renders the pair grid", () => {
    const container = renderDashboard();
    expect(container.querySelector("[data-testid='gtg-dash-grid']")).not.toBeNull();
  });

  it("renders the same number of badge rows as FG_BG_PAIRING_MAP entries that have resolved colors", () => {
    const container = renderDashboard();

    // Compute expected count: pairs in the pairing map that validateThemeContrast
    // would include (both fg and bg present in Brio resolved map).
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, FG_BG_PAIRING_MAP);
    const expectedCount = results.length;

    const badges = container.querySelectorAll("[data-testid='gtg-dash-badge']");
    expect(badges.length).toBe(expectedCount);
  });

  it("pairing map has entries", () => {
    expect(FG_BG_PAIRING_MAP.length).toBeGreaterThan(0);
  });

  it("renders fg and bg swatches for each evaluated pair", () => {
    const container = renderDashboard();
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, FG_BG_PAIRING_MAP);
    const expectedCount = results.length;

    const fgSwatches = container.querySelectorAll("[data-testid='gtg-dash-fg-swatch']");
    const bgSwatches = container.querySelectorAll("[data-testid='gtg-dash-bg-swatch']");
    expect(fgSwatches.length).toBe(expectedCount);
    expect(bgSwatches.length).toBe(expectedCount);
  });
});

// ---------------------------------------------------------------------------
// T7.2: Brio recipe shows all non-intentional body-text pairs as passing
// ---------------------------------------------------------------------------

describe("contrast-dashboard – T7.2: Brio body-text pairs pass", () => {
  // The same intentionally-below-threshold set documented in theme-accessibility.test.ts.
  // These tokens are by design below 4.5:1 in the Brio dark theme.
  const INTENTIONALLY_BELOW_THRESHOLD = new Set([
    "--tug-base-fg-subtle",
    "--tug-base-fg-placeholder",
    "--tug-base-fg-link-hover",
    "--tug-base-control-selected-fg",
    "--tug-base-control-highlighted-fg",
    "--tug-base-field-helper",
    "--tug-base-selection-fg",
    "--tug-base-fg-link",
  ]);

  it("all Brio body-text pairs outside the intentional-exception set pass WCAG AA (4.5:1)", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, FG_BG_PAIRING_MAP);

    const bodyTextResults = results.filter((r) => r.role === "body-text");
    expect(bodyTextResults.length).toBeGreaterThan(0);

    const unexpectedFailures = bodyTextResults.filter(
      (r) => !r.wcagPass && !INTENTIONALLY_BELOW_THRESHOLD.has(r.fg),
    );

    expect(unexpectedFailures).toEqual([]);
  });

  it("the dashboard renders Pass badges for body-text pairs that pass", () => {
    // This is a rendering integration test: render with Brio defaults (initial state),
    // then check that the dashboard contains at least one Pass badge.
    const container = renderDashboard();
    const passBadges = container.querySelectorAll("[data-variant='pass']");
    expect(passBadges.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// T7.3: Summary bar count matches actual pass/fail results
// ---------------------------------------------------------------------------

describe("contrast-dashboard – T7.3: summary bar count matches results", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("summary bar is rendered", () => {
    const container = renderDashboard();
    expect(container.querySelector("[data-testid='gtg-dash-summary']")).not.toBeNull();
  });

  it("summary count element is rendered", () => {
    const container = renderDashboard();
    expect(container.querySelector("[data-testid='gtg-dash-summary-count']")).not.toBeNull();
  });

  it("summary bar count text matches computed pass/total for Brio", () => {
    const container = renderDashboard();

    // Compute expected values from pure logic
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, FG_BG_PAIRING_MAP);
    const passCount = results.filter((r) => r.role !== "decorative" && r.wcagPass).length;
    const checkedCount = results.filter((r) => r.role !== "decorative").length;

    const summaryCount = container.querySelector("[data-testid='gtg-dash-summary-count']");
    expect(summaryCount).not.toBeNull();
    expect(summaryCount!.textContent).toBe(`${passCount}/${checkedCount}`);
  });

  it("summary mentions 'pairs pass WCAG AA'", () => {
    const container = renderDashboard();
    const summary = container.querySelector("[data-testid='gtg-dash-summary']");
    expect(summary!.textContent).toContain("pairs pass WCAG AA");
  });

  it("badge counts are consistent with summary: pass count equals number of Pass badges", () => {
    const container = renderDashboard();

    // Compute expected pass count from logic
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, FG_BG_PAIRING_MAP);
    const expectedPassCount = results.filter((r) => r.role !== "decorative" && r.wcagPass).length;

    // Count rendered Pass badges
    const passBadges = container.querySelectorAll("[data-variant='pass']");
    expect(passBadges.length).toBe(expectedPassCount);
  });

  it("fail badge count is consistent with summary", () => {
    const container = renderDashboard();

    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, FG_BG_PAIRING_MAP);
    const expectedFailCount = results.filter((r) => r.role !== "decorative" && !r.wcagPass).length;

    // Fail badges = "fail" + "marginal" variants (both are non-passing)
    const failBadges = container.querySelectorAll("[data-variant='fail']");
    const marginalBadges = container.querySelectorAll("[data-variant='marginal']");
    const renderedFailCount = failBadges.length + marginalBadges.length;
    expect(renderedFailCount).toBe(expectedFailCount);
  });
});
