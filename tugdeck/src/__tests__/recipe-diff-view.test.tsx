/**
 * recipe-diff-view.test.tsx — RecipeDiffView unit tests.
 *
 * Tests cover:
 * - T4.1: RecipeDiffView with all parameters at 50 shows zero-width bars (no deviation).
 * - T4.2: RecipeDiffView with surfaceDepth=80 shows a rightward bar for Surface Depth with delta=+30.
 * - T4.3: Expanding a parameter bar shows field-level detail with correct values and deltas.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

import { RecipeDiffView } from "@/components/tugways/recipe-diff-view";
import {
  compileRecipe,
  defaultParameters,
  getParameterFields,
} from "@/components/tugways/recipe-parameters";
import { PARAMETER_METADATA } from "@/components/tugways/parameter-slider";

// ---------------------------------------------------------------------------
// T4.1: All parameters at 50 shows zero-width bars (no deviation)
// ---------------------------------------------------------------------------

describe("RecipeDiffView – T4.1: all parameters at 50 shows zero-width bars", () => {
  it("renders the outer collapsible wrapper", () => {
    const parameters = defaultParameters();
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    const wrapper = getByTestId("recipe-diff-view");
    expect(wrapper).not.toBeNull();
    expect(wrapper.tagName.toLowerCase()).toBe("details");
  });

  it("renders 7 parameter bar sections", () => {
    const parameters = defaultParameters();
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    for (const meta of PARAMETER_METADATA) {
      const bar = getByTestId(`rdv-bar-${meta.paramKey}`);
      expect(bar).not.toBeNull();
    }
  });

  it("shows delta=±0 for each parameter when all are at 50", () => {
    const parameters = defaultParameters();
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    for (const meta of PARAMETER_METADATA) {
      const deltaEl = getByTestId(`rdv-delta-${meta.paramKey}`);
      expect(deltaEl.textContent).toBe("±0");
    }
  });

  it("shows zero-width left fill for each parameter at default", () => {
    const parameters = defaultParameters();
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    for (const meta of PARAMETER_METADATA) {
      const fillLeft = getByTestId(`rdv-fill-left-${meta.paramKey}`);
      // style width should be 0%
      expect(fillLeft.getAttribute("style")).toContain("width: 0%");
    }
  });

  it("shows zero-width right fill for each parameter at default", () => {
    const parameters = defaultParameters();
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    for (const meta of PARAMETER_METADATA) {
      const fillRight = getByTestId(`rdv-fill-right-${meta.paramKey}`);
      expect(fillRight.getAttribute("style")).toContain("width: 0%");
    }
  });
});

// ---------------------------------------------------------------------------
// T4.2: RecipeDiffView with surfaceDepth=80 shows rightward bar with delta=+30
// ---------------------------------------------------------------------------

describe("RecipeDiffView – T4.2: surfaceDepth=80 shows rightward bar with delta=+30", () => {
  it("shows delta=+30 for surfaceDepth when value=80", () => {
    const parameters = { ...defaultParameters(), surfaceDepth: 80 };
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    const deltaEl = getByTestId("rdv-delta-surfaceDepth");
    expect(deltaEl.textContent).toBe("+30");
  });

  it("shows current value=80 for surfaceDepth", () => {
    const parameters = { ...defaultParameters(), surfaceDepth: 80 };
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    const valueEl = getByTestId("rdv-value-surfaceDepth");
    expect(valueEl.textContent).toBe("80");
  });

  it("shows right fill with width=60% for surfaceDepth=80 (delta=30 out of 50 max)", () => {
    const parameters = { ...defaultParameters(), surfaceDepth: 80 };
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    const fillRight = getByTestId("rdv-fill-right-surfaceDepth");
    // delta=30, max=50, so 30/50=60%
    expect(fillRight.getAttribute("style")).toContain("width: 60%");
  });

  it("shows zero-width left fill for surfaceDepth=80 (positive deviation)", () => {
    const parameters = { ...defaultParameters(), surfaceDepth: 80 };
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    const fillLeft = getByTestId("rdv-fill-left-surfaceDepth");
    expect(fillLeft.getAttribute("style")).toContain("width: 0%");
  });

  it("shows delta=±0 for non-surfaceDepth parameters (still at default)", () => {
    const parameters = { ...defaultParameters(), surfaceDepth: 80 };
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    // All other parameters remain at 50 — should show ±0
    for (const meta of PARAMETER_METADATA) {
      if (meta.paramKey === "surfaceDepth") continue;
      const deltaEl = getByTestId(`rdv-delta-${meta.paramKey}`);
      expect(deltaEl.textContent).toBe("±0");
    }
  });

  it("shows left fill for negative deviation (surfaceDepth=20, delta=-30)", () => {
    const parameters = { ...defaultParameters(), surfaceDepth: 20 };
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    const deltaEl = getByTestId("rdv-delta-surfaceDepth");
    expect(deltaEl.textContent).toBe("-30");

    const fillLeft = getByTestId("rdv-fill-left-surfaceDepth");
    // delta=-30, abs=30, max=50, so 30/50=60%
    expect(fillLeft.getAttribute("style")).toContain("width: 60%");

    const fillRight = getByTestId("rdv-fill-right-surfaceDepth");
    expect(fillRight.getAttribute("style")).toContain("width: 0%");
  });
});

// ---------------------------------------------------------------------------
// T4.3: Expanding a parameter bar shows field-level detail with correct values and deltas
// ---------------------------------------------------------------------------

// Helper: open a parameter bar's <details> section to trigger deferred FieldDetail rendering.
// Sets barEl.open = true and dispatches a 'toggle' event to fire the React onToggle handler.
function openParamBar(
  getByTestId: (id: string) => HTMLElement,
  paramKey: string,
): void {
  const barEl = getByTestId(`rdv-bar-${paramKey}`) as HTMLDetailsElement;
  act(() => {
    barEl.open = true;
    fireEvent(barEl, new Event("toggle", { bubbles: false }));
  });
}

describe("RecipeDiffView – T4.3: field-level detail shows correct values and deltas", () => {
  it("renders field list for surfaceDepth with expected fields after opening", () => {
    const parameters = { ...defaultParameters(), surfaceDepth: 80 };
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    // Open the surfaceDepth bar to trigger deferred FieldDetail rendering.
    openParamBar(getByTestId, "surfaceDepth");

    const fieldList = getByTestId("rdv-field-list-surfaceDepth");
    expect(fieldList).not.toBeNull();

    const fields = getParameterFields("surfaceDepth", "dark");
    expect(fields.length).toBeGreaterThan(0);

    for (const fieldName of fields) {
      const fieldItem = getByTestId(`rdv-field-surfaceDepth-${fieldName}`);
      expect(fieldItem).not.toBeNull();
    }
  });

  it("shows correct current, default, and delta values for surfaceDepth=80", () => {
    const parameters = { ...defaultParameters(), surfaceDepth: 80 };
    const compiledFormulas = compileRecipe("dark", parameters);
    const baselineFormulas = compileRecipe("dark", defaultParameters());

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    // Open the surfaceDepth bar to trigger deferred FieldDetail rendering.
    openParamBar(getByTestId, "surfaceDepth");

    const fields = getParameterFields("surfaceDepth", "dark");
    for (const fieldName of fields) {
      const currentRaw = (compiledFormulas as unknown as Record<string, unknown>)[fieldName];
      const defaultRaw = (baselineFormulas as unknown as Record<string, unknown>)[fieldName];

      if (typeof currentRaw === "number" && typeof defaultRaw === "number") {
        const currentEl = getByTestId(`rdv-field-current-surfaceDepth-${fieldName}`);
        expect(currentEl.textContent).toBe(currentRaw.toFixed(2));

        const defaultEl = getByTestId(`rdv-field-default-surfaceDepth-${fieldName}`);
        expect(defaultEl.textContent).toBe(defaultRaw.toFixed(2));

        const expectedDelta = currentRaw - defaultRaw;
        const deltaEl = getByTestId(`rdv-field-delta-surfaceDepth-${fieldName}`);
        if (expectedDelta === 0) {
          expect(deltaEl.textContent).toBe("±0");
        } else if (expectedDelta > 0) {
          expect(deltaEl.textContent).toBe(`+${expectedDelta.toFixed(2)}`);
        } else {
          expect(deltaEl.textContent).toBe(expectedDelta.toFixed(2));
        }
      }
    }
  });

  it("shows zero deltas for all fields when parameters are at default (all-50)", () => {
    const parameters = defaultParameters();
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    // Open the surfaceDepth bar to trigger deferred FieldDetail rendering.
    openParamBar(getByTestId, "surfaceDepth");

    // For default parameters, all field-level deltas should be ±0
    const fields = getParameterFields("surfaceDepth", "dark");
    for (const fieldName of fields) {
      const deltaEl = getByTestId(`rdv-field-delta-surfaceDepth-${fieldName}`);
      expect(deltaEl.textContent).toBe("±0");
    }
  });

  it("renders field lists for all 7 parameters after opening each", () => {
    const parameters = defaultParameters();
    const compiledFormulas = compileRecipe("dark", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="dark"
      />,
    );

    for (const meta of PARAMETER_METADATA) {
      // Open each bar section to trigger deferred FieldDetail rendering.
      openParamBar(getByTestId, meta.paramKey);

      const fieldList = getByTestId(`rdv-field-list-${meta.paramKey}`);
      expect(fieldList).not.toBeNull();

      const fields = getParameterFields(meta.paramKey, "dark");
      expect(fields.length).toBeGreaterThan(0);
    }
  });

  it("works correctly in light mode", () => {
    const parameters = { ...defaultParameters(), textHierarchy: 70 };
    const compiledFormulas = compileRecipe("light", parameters);

    const { getByTestId } = render(
      <RecipeDiffView
        parameters={parameters}
        compiledFormulas={compiledFormulas}
        mode="light"
      />,
    );

    const deltaEl = getByTestId("rdv-delta-textHierarchy");
    expect(deltaEl.textContent).toBe("+20");

    const valueEl = getByTestId("rdv-value-textHierarchy");
    expect(valueEl.textContent).toBe("70");
  });
});
