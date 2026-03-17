/**
 * cvd-preview-auto-fix tests — Steps 8 and 5.
 *
 * Tests cover:
 * - T8.1: CVD strip renders 4 simulation rows (one per type)
 * - T8.2: Each row shows the correct number of semantic color swatches
 * - T8.3: Contrast diagnostics panel renders and shows diagnostic output
 *         (replaces former auto-fix button tests — Step 5)
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { GalleryThemeGeneratorContent } from "@/components/tugways/cards/gallery-theme-generator-content";
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
// T8.3: Contrast diagnostics panel renders and shows diagnostic output (Step 5)
//
// The former auto-fix button has been replaced by a ContrastDiagnosticsPanel.
// The panel displays ThemeOutput.diagnostics entries from the derivation engine:
//   - "floor-applied": tokens clamped by enforceContrastFloor to meet threshold
//   - "structurally-fixed": tokens that are not adjustable (alpha, black, white)
//
// There is no longer a button to click — diagnostics are produced by deriveTheme()
// directly and displayed immediately.
// ---------------------------------------------------------------------------

describe("contrast-diagnostics – T8.3: panel renders diagnostic output", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders the diagnostics panel container", () => {
    const container = renderComponent();
    expect(container.querySelector("[data-testid='gtg-autofix-panel']")).not.toBeNull();
  });

  it("renders the floor diagnostics section", () => {
    const container = renderComponent();
    expect(container.querySelector("[data-testid='gtg-diag-floor-section']")).not.toBeNull();
  });

  it("renders the floor diagnostics title", () => {
    const container = renderComponent();
    const title = container.querySelector("[data-testid='gtg-diag-floor-title']");
    expect(title).not.toBeNull();
    // Title text should mention floor-applied count or confirm no adjustments needed
    expect(title!.textContent).not.toBe("");
  });

  it("does NOT render the former auto-fix button", () => {
    // The gtg-autofix-btn was removed in Step 5 — no button should be present
    const container = renderComponent();
    expect(container.querySelector("[data-testid='gtg-autofix-btn']")).toBeNull();
  });

  it("diagnostics panel content matches ThemeOutput.diagnostics from deriveTheme", () => {
    // Pure logic test: verify the engine produces the same diagnostics that the UI
    // would display. This catches any mismatch between render path and engine output.
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const floorApplied = brioOutput.diagnostics.filter((d) => d.reason === "floor-applied");

    const container = renderComponent();

    // If engine produced floor-applied entries, the list should be rendered
    if (floorApplied.length > 0) {
      const list = container.querySelector("[data-testid='gtg-diag-floor-list']");
      expect(list).not.toBeNull();
      const items = container.querySelectorAll("[data-testid='gtg-diag-floor-item']");
      expect(items.length).toBe(floorApplied.length);
    }
  });

  it("each floor-applied item shows token name and tone delta", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const floorApplied = brioOutput.diagnostics.filter((d) => d.reason === "floor-applied");

    if (floorApplied.length === 0) return; // nothing to verify

    const container = renderComponent();
    const items = container.querySelectorAll("[data-testid='gtg-diag-floor-item']");

    for (let i = 0; i < Math.min(items.length, 3); i++) {
      const item = items[i] as HTMLElement;
      const tokenSpan = item.querySelector("[class*='gtg-diag-token']") as HTMLElement | null;
      const detailSpan = item.querySelector("[class*='gtg-diag-detail']") as HTMLElement | null;
      expect(tokenSpan).not.toBeNull();
      expect(detailSpan).not.toBeNull();
      // Token name should start with --tug-base-
      expect(tokenSpan!.textContent ?? "").toMatch(/--tug-base-/);
      // Detail should contain tone arrow (→)
      expect(detailSpan!.textContent ?? "").toContain("→");
    }
  });
});
