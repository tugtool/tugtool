/**
 * style-inspector-formula tests — Step 3: formula provenance section.
 *
 * Tests cover:
 * - createFormulaSection returns a DOM element with expected field names and values
 * - createFormulaSection shows "(constant)" for empty rows
 * - createFormulaSection includes "(applies on release)" for structural fields
 * - createFormulaSection renders multiple fields correctly
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";

import {
  createFormulaSection,
  type FormulaRow,
} from "@/components/tugways/style-inspector-overlay";

// ---------------------------------------------------------------------------
// Unit tests: createFormulaSection
// ---------------------------------------------------------------------------

describe("createFormulaSection", () => {
  it("TC1: returns a section element with 'Formula' title", () => {
    const rows: FormulaRow[] = [
      { field: "surfaceAppTone", value: 8, property: "tone", isStructural: false },
    ];
    const section = createFormulaSection(rows, false);

    expect(section.tagName.toLowerCase()).toBe("div");
    const title = section.querySelector(".tug-inspector-section__title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe("Formula");
  });

  it("TC2: shows field name, value, and property label for a single row", () => {
    const rows: FormulaRow[] = [
      { field: "surfaceAppTone", value: 8, property: "tone", isStructural: false },
    ];
    const section = createFormulaSection(rows, false);

    const fieldEl = section.querySelector(".tug-inspector-formula__field");
    expect(fieldEl).not.toBeNull();
    expect(fieldEl!.textContent).toBe("surfaceAppTone");

    const valEl = section.querySelector(".tug-inspector-formula__value");
    expect(valEl).not.toBeNull();
    expect(valEl!.textContent).toBe("8");

    const propEl = section.querySelector(".tug-inspector-formula__prop");
    expect(propEl).not.toBeNull();
    expect(propEl!.textContent).toBe("tone");
  });

  it("TC3: shows '(constant)' when isConstant is true", () => {
    const section = createFormulaSection([], true);

    const dim = section.querySelector(".tug-inspector-row__value--dim");
    expect(dim).not.toBeNull();
    expect(dim!.textContent).toBe("(constant)");
  });

  it("TC4: shows '(constant)' when rows array is empty even if isConstant is false", () => {
    const section = createFormulaSection([], false);

    const dim = section.querySelector(".tug-inspector-row__value--dim");
    expect(dim).not.toBeNull();
    expect(dim!.textContent).toBe("(constant)");
  });

  it("TC5: renders multiple formula fields", () => {
    const rows: FormulaRow[] = [
      { field: "surfaceAppTone", value: 8, property: "tone", isStructural: false },
      { field: "surfaceAppIntensity", value: 3, property: "intensity", isStructural: false },
      { field: "surfaceAppHueSlot", value: "frame", property: "hueSlot", isStructural: false },
    ];
    const section = createFormulaSection(rows, false);

    const fieldEls = section.querySelectorAll(".tug-inspector-formula__field");
    expect(fieldEls.length).toBe(3);
    expect(fieldEls[0].textContent).toBe("surfaceAppTone");
    expect(fieldEls[1].textContent).toBe("surfaceAppIntensity");
    expect(fieldEls[2].textContent).toBe("surfaceAppHueSlot");
  });

  it("TC6: shows string field values correctly (hue slot)", () => {
    const rows: FormulaRow[] = [
      { field: "surfaceAppHueSlot", value: "frame", property: "hueSlot", isStructural: false },
    ];
    const section = createFormulaSection(rows, false);

    const valEl = section.querySelector(".tug-inspector-formula__value");
    expect(valEl).not.toBeNull();
    expect(valEl!.textContent).toBe("frame");
  });

  it("TC7: includes '(applies on release)' label for structural fields", () => {
    const rows: FormulaRow[] = [
      { field: "someRadiusField", value: 4, property: "tone", isStructural: true },
    ];
    const section = createFormulaSection(rows, false);

    const releaseLabel = section.querySelector(".tug-inspector-formula__release-label");
    expect(releaseLabel).not.toBeNull();
    expect(releaseLabel!.textContent).toBe("(applies on release)");
  });

  it("TC8: does NOT include '(applies on release)' for non-structural fields", () => {
    const rows: FormulaRow[] = [
      { field: "surfaceAppTone", value: 8, property: "tone", isStructural: false },
    ];
    const section = createFormulaSection(rows, false);

    const releaseLabel = section.querySelector(".tug-inspector-formula__release-label");
    expect(releaseLabel).toBeNull();
  });

  it("TC9: formats numeric value with toPrecision(3) rounding", () => {
    const rows: FormulaRow[] = [
      { field: "roleIntensity", value: 50.123456, property: "intensity", isStructural: false },
    ];
    const section = createFormulaSection(rows, false);

    const valEl = section.querySelector(".tug-inspector-formula__value");
    expect(valEl).not.toBeNull();
    // toPrecision(3) of 50.123456 => "50.1"
    expect(valEl!.textContent).toBe("50.1");
  });

  it("TC10: formats boolean field values as strings", () => {
    const rows: FormulaRow[] = [
      { field: "selectionInactiveSemanticMode", value: true, property: "tone", isStructural: false },
    ];
    const section = createFormulaSection(rows, false);

    const valEl = section.querySelector(".tug-inspector-formula__value");
    expect(valEl).not.toBeNull();
    expect(valEl!.textContent).toBe("true");
  });
});
