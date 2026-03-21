/**
 * formula-expansion-panel.test.tsx — FormulaExpansionPanel unit tests.
 *
 * Tests cover:
 * - T3.1: Renders 7 collapsible sections with correct parameter labels.
 * - T3.2: Expanding a section shows field names and numeric values from compiled formulas.
 * - T3.3: Field count in summary matches the number of fields for that parameter.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

import { FormulaExpansionPanel } from "@/components/tugways/formula-expansion-panel";
import {
  compileRecipe,
  defaultParameters,
  getParameterFields,
} from "@/components/tugways/recipe-parameters";
import { PARAMETER_METADATA } from "@/components/tugways/parameter-slider";

// ---------------------------------------------------------------------------
// T3.1: Renders 7 collapsible sections with correct parameter labels
// ---------------------------------------------------------------------------

describe("FormulaExpansionPanel – T3.1: renders 7 collapsible sections with correct labels", () => {
  it("renders 7 <details> sections (one per parameter)", () => {
    const compiledFormulas = compileRecipe("dark", defaultParameters());
    const parameters = defaultParameters();

    const { getByTestId } = render(
      <FormulaExpansionPanel
        compiledFormulas={compiledFormulas}
        parameters={parameters}
        mode="dark"
      />,
    );

    const panel = getByTestId("formula-expansion-panel");
    expect(panel).not.toBeNull();

    for (const meta of PARAMETER_METADATA) {
      const section = getByTestId(`fep-section-${meta.paramKey}`);
      expect(section).not.toBeNull();
      expect(section.tagName.toLowerCase()).toBe("details");
    }
  });

  it("renders the correct parameter label in each section summary", () => {
    const compiledFormulas = compileRecipe("dark", defaultParameters());
    const parameters = defaultParameters();

    const { getByTestId } = render(
      <FormulaExpansionPanel
        compiledFormulas={compiledFormulas}
        parameters={parameters}
        mode="dark"
      />,
    );

    for (const meta of PARAMETER_METADATA) {
      const summary = getByTestId(`fep-summary-${meta.paramKey}`);
      expect(summary.textContent).toContain(meta.label);
    }
  });

  it("renders all 7 parameter labels per PARAMETER_METADATA", () => {
    const compiledFormulas = compileRecipe("light", defaultParameters());
    const parameters = defaultParameters();

    const { getByTestId } = render(
      <FormulaExpansionPanel
        compiledFormulas={compiledFormulas}
        parameters={parameters}
        mode="light"
      />,
    );

    const expectedLabels = PARAMETER_METADATA.map((m) => m.label);
    for (const label of expectedLabels) {
      const meta = PARAMETER_METADATA.find((m) => m.label === label)!;
      const summary = getByTestId(`fep-summary-${meta.paramKey}`);
      expect(summary.textContent).toContain(label);
    }
  });
});

// ---------------------------------------------------------------------------
// T3.2: Expanding a section shows field names and numeric values from compiled formulas
// ---------------------------------------------------------------------------

describe("FormulaExpansionPanel – T3.2: shows field names and values from compiled formulas", () => {
  it("renders a field list for surfaceDepth with field names and numeric values", () => {
    const compiledFormulas = compileRecipe("dark", defaultParameters());
    const parameters = defaultParameters();

    const { getByTestId } = render(
      <FormulaExpansionPanel
        compiledFormulas={compiledFormulas}
        parameters={parameters}
        mode="dark"
      />,
    );

    const fields = getParameterFields("surfaceDepth", "dark");
    const fieldList = getByTestId("fep-field-list-surfaceDepth");
    expect(fieldList).not.toBeNull();

    // All field items should be present
    for (const fieldName of fields) {
      const nameEl = getByTestId(`fep-field-name-surfaceDepth-${fieldName}`);
      expect(nameEl.textContent).toBe(fieldName);

      const valueEl = getByTestId(`fep-field-value-surfaceDepth-${fieldName}`);
      const rawValue = (compiledFormulas as Record<string, unknown>)[fieldName];
      if (typeof rawValue === "number") {
        expect(valueEl.textContent).toBe(rawValue.toFixed(2));
      }
    }
  });

  it("shows correct field values for non-default parameters (surfaceDepth=80)", () => {
    const params = { ...defaultParameters(), surfaceDepth: 80 };
    const compiledFormulas = compileRecipe("dark", params);

    const { getByTestId } = render(
      <FormulaExpansionPanel
        compiledFormulas={compiledFormulas}
        parameters={params}
        mode="dark"
      />,
    );

    const fields = getParameterFields("surfaceDepth", "dark");
    for (const fieldName of fields) {
      const expectedRaw = (compiledFormulas as Record<string, unknown>)[fieldName];
      const valueEl = getByTestId(`fep-field-value-surfaceDepth-${fieldName}`);
      if (typeof expectedRaw === "number") {
        expect(valueEl.textContent).toBe(expectedRaw.toFixed(2));
      }
    }
  });

  it("renders field values for light mode", () => {
    const compiledFormulas = compileRecipe("light", defaultParameters());
    const parameters = defaultParameters();

    const { getByTestId } = render(
      <FormulaExpansionPanel
        compiledFormulas={compiledFormulas}
        parameters={parameters}
        mode="light"
      />,
    );

    const fields = getParameterFields("textHierarchy", "light");
    for (const fieldName of fields) {
      const nameEl = getByTestId(`fep-field-name-textHierarchy-${fieldName}`);
      expect(nameEl.textContent).toBe(fieldName);
    }
  });
});

// ---------------------------------------------------------------------------
// T3.3: Field count in summary matches the number of fields for that parameter
// ---------------------------------------------------------------------------

describe("FormulaExpansionPanel – T3.3: field count in summary matches actual field count", () => {
  it("displays correct field count for each parameter in dark mode", () => {
    const compiledFormulas = compileRecipe("dark", defaultParameters());
    const parameters = defaultParameters();

    const { getByTestId } = render(
      <FormulaExpansionPanel
        compiledFormulas={compiledFormulas}
        parameters={parameters}
        mode="dark"
      />,
    );

    for (const meta of PARAMETER_METADATA) {
      const expectedCount = getParameterFields(meta.paramKey, "dark").length;
      const countEl = getByTestId(`fep-field-count-${meta.paramKey}`);
      expect(countEl.textContent).toBe(`${expectedCount} fields`);
    }
  });

  it("displays correct field count for each parameter in light mode", () => {
    const compiledFormulas = compileRecipe("light", defaultParameters());
    const parameters = defaultParameters();

    const { getByTestId } = render(
      <FormulaExpansionPanel
        compiledFormulas={compiledFormulas}
        parameters={parameters}
        mode="light"
      />,
    );

    for (const meta of PARAMETER_METADATA) {
      const expectedCount = getParameterFields(meta.paramKey, "light").length;
      const countEl = getByTestId(`fep-field-count-${meta.paramKey}`);
      expect(countEl.textContent).toBe(`${expectedCount} fields`);
    }
  });

  it("field count in summary matches the number of rendered field items", () => {
    const compiledFormulas = compileRecipe("dark", defaultParameters());
    const parameters = defaultParameters();

    const { getByTestId } = render(
      <FormulaExpansionPanel
        compiledFormulas={compiledFormulas}
        parameters={parameters}
        mode="dark"
      />,
    );

    for (const meta of PARAMETER_METADATA) {
      const fields = getParameterFields(meta.paramKey, "dark");
      const fieldList = getByTestId(`fep-field-list-${meta.paramKey}`);
      const items = fieldList.querySelectorAll(".fep-field-item");
      expect(items.length).toBe(fields.length);
    }
  });
});
