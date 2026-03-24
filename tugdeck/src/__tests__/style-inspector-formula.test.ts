/**
 * style-inspector-formula tests — createFormulaSection DOM rendering.
 *
 * Tests cover:
 * - With mock formula rows → produces correct DOM structure
 * - With empty rows → shows constant indicator
 * - With structural row → shows release label
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";
import {
  createFormulaSection,
  type FormulaRow,
} from "@/components/tugways/style-inspector-core";

// ---------------------------------------------------------------------------
// createFormulaSection — with formula rows
// ---------------------------------------------------------------------------

describe("createFormulaSection — with rows", () => {
  it("produces a section with the correct title", () => {
    const rows: FormulaRow[] = [
      { field: "contentTextIntensity", value: 4, property: "intensity", isStructural: false },
      { field: "contentTextTone", value: 92, property: "tone", isStructural: false },
    ];

    const section = createFormulaSection(rows, false);
    expect(section).toBeDefined();

    const title = section.querySelector(".tug-inspector-section__title");
    expect(title).toBeDefined();
    expect(title!.textContent).toBe("Formula");
  });

  it("renders one row element per formula row", () => {
    const rows: FormulaRow[] = [
      { field: "contentTextIntensity", value: 4, property: "intensity", isStructural: false },
      { field: "contentTextTone", value: 92, property: "tone", isStructural: false },
    ];

    const section = createFormulaSection(rows, false);
    const rowEls = section.querySelectorAll(".tug-inspector-formula-field");
    expect(rowEls.length).toBe(2);
  });

  it("shows field name, value, and property type in each row", () => {
    const rows: FormulaRow[] = [
      { field: "surfaceCanvasIntensity", value: 3, property: "intensity", isStructural: false },
    ];

    const section = createFormulaSection(rows, false);
    const rowEl = section.querySelector(".tug-inspector-formula-field");
    expect(rowEl).toBeDefined();

    const nameEl = rowEl!.querySelector(".tug-inspector-formula-field__name");
    expect(nameEl!.textContent).toBe("surfaceCanvasIntensity");

    const valueEl = rowEl!.querySelector(".tug-inspector-formula-field__value");
    expect(valueEl!.textContent).toBe("3");

    const typeEl = rowEl!.querySelector(".tug-inspector-formula-field__type");
    expect(typeEl!.textContent).toBe("intensity");
  });

  it("does NOT show a release label for non-structural rows", () => {
    const rows: FormulaRow[] = [
      { field: "contentTextTone", value: 90, property: "tone", isStructural: false },
    ];

    const section = createFormulaSection(rows, false);
    const releaseLabel = section.querySelector(".tug-inspector-formula__release-label");
    expect(releaseLabel).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createFormulaSection — with empty rows (constant)
// ---------------------------------------------------------------------------

describe("createFormulaSection — constant indicator", () => {
  it("shows (constant) indicator when rows is empty", () => {
    const section = createFormulaSection([], false);

    const constantEl = section.querySelector(".tug-inspector-row__value--dim");
    expect(constantEl).toBeDefined();
    expect(constantEl!.textContent).toBe("(constant)");
  });

  it("shows (constant) indicator when isConstant is true even with rows", () => {
    const rows: FormulaRow[] = [
      { field: "contentTextTone", value: 90, property: "tone", isStructural: false },
    ];
    const section = createFormulaSection(rows, true);

    const constantEl = section.querySelector(".tug-inspector-row__value--dim");
    expect(constantEl).toBeDefined();
    expect(constantEl!.textContent).toBe("(constant)");
  });

  it("does NOT show formula rows when isConstant is true", () => {
    const rows: FormulaRow[] = [
      { field: "contentTextTone", value: 90, property: "tone", isStructural: false },
    ];
    const section = createFormulaSection(rows, true);

    const rowEls = section.querySelectorAll(".tug-inspector-formula-field");
    expect(rowEls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createFormulaSection — structural row with release label
// ---------------------------------------------------------------------------

describe("createFormulaSection — structural row", () => {
  it("shows release label for structural rows", () => {
    const rows: FormulaRow[] = [
      { field: "contentTextTone", value: 92, property: "tone", isStructural: true },
    ];

    const section = createFormulaSection(rows, false);
    const releaseLabel = section.querySelector(".tug-inspector-formula__release-label");
    expect(releaseLabel).toBeDefined();
    expect(releaseLabel!.textContent).toBe("(applies on release)");
  });

  it("shows release label only on structural rows in mixed list", () => {
    const rows: FormulaRow[] = [
      { field: "contentTextIntensity", value: 4, property: "intensity", isStructural: false },
      { field: "contentTextTone", value: 92, property: "tone", isStructural: true },
    ];

    const section = createFormulaSection(rows, false);
    const allRows = section.querySelectorAll(".tug-inspector-formula-field");
    expect(allRows.length).toBe(2);

    // Only the second row should have a release label
    const firstRowLabel = allRows[0].querySelector(".tug-inspector-formula__release-label");
    const secondRowLabel = allRows[1].querySelector(".tug-inspector-formula__release-label");
    expect(firstRowLabel).toBeNull();
    expect(secondRowLabel).toBeDefined();
  });
});
