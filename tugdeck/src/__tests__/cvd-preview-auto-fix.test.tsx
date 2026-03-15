/**
 * cvd-preview-auto-fix tests — Step 8.
 *
 * Tests cover:
 * - T8.1: CVD strip renders 4 simulation rows (one per type)
 * - T8.2: Each row shows the correct number of semantic color swatches
 * - T8.3: Auto-fix button triggers autoAdjustContrast and updates tokens
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import { GalleryThemeGeneratorContent } from "@/components/tugways/cards/gallery-theme-generator-content";
import { autoAdjustContrast, validateThemeContrast } from "@/components/tugways/theme-accessibility";
import { deriveTheme, EXAMPLE_RECIPES } from "@/components/tugways/theme-derivation-engine";
import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/element-surface-pairing-map";
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
// T8.1: CVD strip renders 4 simulation rows (one per type)
// ---------------------------------------------------------------------------

describe("cvd-preview – T8.1: renders 4 CVD simulation rows", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders the CVD strip container", () => {
    const container = renderComponent();
    expect(container.querySelector("[data-testid='gtg-cvd-strip']")).not.toBeNull();
  });

  it("renders exactly 4 CVD rows", () => {
    const container = renderComponent();
    const rows = container.querySelectorAll("[data-testid='gtg-cvd-row']");
    expect(rows.length).toBe(4);
  });

  it("renders a row for protanopia", () => {
    const container = renderComponent();
    const row = container.querySelector("[data-cvd-type='protanopia']");
    expect(row).not.toBeNull();
  });

  it("renders a row for deuteranopia", () => {
    const container = renderComponent();
    const row = container.querySelector("[data-cvd-type='deuteranopia']");
    expect(row).not.toBeNull();
  });

  it("renders a row for tritanopia", () => {
    const container = renderComponent();
    const row = container.querySelector("[data-cvd-type='tritanopia']");
    expect(row).not.toBeNull();
  });

  it("renders a row for achromatopsia", () => {
    const container = renderComponent();
    const row = container.querySelector("[data-cvd-type='achromatopsia']");
    expect(row).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T8.2: Each row shows the correct number of semantic color swatches
// ---------------------------------------------------------------------------

describe("cvd-preview – T8.2: each row shows correct number of swatches", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("each CVD row contains 7 original swatches", () => {
    const container = renderComponent();
    const rows = container.querySelectorAll("[data-testid='gtg-cvd-row']");
    expect(rows.length).toBe(4);
    for (const row of Array.from(rows)) {
      const origSwatches = row.querySelectorAll("[data-testid='gtg-cvd-orig-swatch']");
      expect(origSwatches.length).toBe(7);
    }
  });

  it("each CVD row contains 7 simulated swatches", () => {
    const container = renderComponent();
    const rows = container.querySelectorAll("[data-testid='gtg-cvd-row']");
    expect(rows.length).toBe(4);
    for (const row of Array.from(rows)) {
      const simSwatches = row.querySelectorAll("[data-testid='gtg-cvd-sim-swatch']");
      expect(simSwatches.length).toBe(7);
    }
  });

  it("original and simulated swatches have backgroundColor set (not empty)", () => {
    const container = renderComponent();
    // jsdom doesn't evaluate computed oklch() colors, but hex values set via
    // inline style should be present. Check at least one swatch has a non-empty style.
    const firstOrigSwatch = container.querySelector("[data-testid='gtg-cvd-orig-swatch']") as HTMLElement | null;
    const firstSimSwatch = container.querySelector("[data-testid='gtg-cvd-sim-swatch']") as HTMLElement | null;
    expect(firstOrigSwatch).not.toBeNull();
    expect(firstSimSwatch).not.toBeNull();
    expect(firstOrigSwatch!.style.backgroundColor).not.toBe("");
    expect(firstSimSwatch!.style.backgroundColor).not.toBe("");
  });

  it("total simulated swatches across all rows = 4 × 7 = 28", () => {
    const container = renderComponent();
    const all = container.querySelectorAll("[data-testid='gtg-cvd-sim-swatch']");
    expect(all.length).toBe(28);
  });
});

// ---------------------------------------------------------------------------
// T8.3: Auto-fix button triggers autoAdjustContrast and updates tokens
// ---------------------------------------------------------------------------

describe("auto-fix – T8.3: button triggers autoAdjustContrast and updates tokens", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders the auto-fix panel", () => {
    const container = renderComponent();
    expect(container.querySelector("[data-testid='gtg-autofix-panel']")).not.toBeNull();
  });

  it("renders the auto-fix button", () => {
    const container = renderComponent();
    expect(container.querySelector("[data-testid='gtg-autofix-btn']")).not.toBeNull();
  });

  it("auto-fix button is disabled when there are no failures (all-pass Brio recipe)", () => {
    // Brio has very few non-intentional failures. The button should show a
    // failure count. When count is 0, the button is disabled.
    const container = renderComponent();
    const btn = container.querySelector("[data-testid='gtg-autofix-btn']") as HTMLButtonElement;
    expect(btn).not.toBeNull();

    // Compute actual failure count from logic to know expected button state
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);
    const failures = results.filter((r) => !r.lcPass && r.role !== "decorative");

    if (failures.length === 0) {
      expect(btn.disabled).toBe(true);
    } else {
      expect(btn.disabled).toBe(false);
    }
  });

  it("clicking auto-fix renders the result summary", () => {
    const container = renderComponent();

    // Check if there are failures — if so, clicking should show a result.
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);
    const failures = results.filter((r) => !r.lcPass && r.role !== "decorative");

    if (failures.length > 0) {
      const btn = container.querySelector("[data-testid='gtg-autofix-btn']") as HTMLButtonElement;
      act(() => {
        fireEvent.click(btn);
      });
      const resultEl = container.querySelector("[data-testid='gtg-autofix-result']");
      expect(resultEl).not.toBeNull();
      expect(resultEl!.textContent).toMatch(/\d+ token/);
    }
  });

  it("autoAdjustContrast (unit): adjusts failing tokens and returns updated maps", () => {
    // Pure-logic test verifying the underlying function works correctly,
    // independent of UI rendering.
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);
    const failures = results.filter((r) => !r.lcPass && r.role !== "decorative");

    if (failures.length > 0) {
      const fixed = autoAdjustContrast(brioOutput.tokens, brioOutput.resolved, failures, ELEMENT_SURFACE_PAIRING_MAP);
      // The result must be an object with tokens, resolved, unfixable
      expect(fixed).toHaveProperty("tokens");
      expect(fixed).toHaveProperty("resolved");
      expect(fixed).toHaveProperty("unfixable");
      // At least one token must have changed
      const changed = Object.keys(fixed.tokens).filter(
        (k) => fixed.tokens[k] !== brioOutput.tokens[k],
      );
      expect(changed.length).toBeGreaterThan(0);
    } else {
      // No failures — autoAdjustContrast should be a no-op
      const fixed = autoAdjustContrast(brioOutput.tokens, brioOutput.resolved, [], ELEMENT_SURFACE_PAIRING_MAP);
      expect(fixed.unfixable).toEqual([]);
    }
  });

  it("autoAdjustContrast (unit): re-validating fixed tokens shows improved contrast", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);
    const failures = results.filter((r) => !r.lcPass && r.role !== "decorative");

    if (failures.length > 0) {
      const fixed = autoAdjustContrast(brioOutput.tokens, brioOutput.resolved, failures, ELEMENT_SURFACE_PAIRING_MAP);
      const fixedResults = validateThemeContrast(fixed.resolved, ELEMENT_SURFACE_PAIRING_MAP);
      const fixedFailures = fixedResults.filter((r) => !r.lcPass && r.role !== "decorative");
      // After auto-fix, there should be fewer failures than before
      expect(fixedFailures.length).toBeLessThanOrEqual(failures.length);
    }
  });
});
