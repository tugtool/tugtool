/**
 * formula-editor-controls tests — Step 5: interactive formula field controls.
 *
 * Tests cover:
 * - createFormulaControls with tone field: slider + number input
 * - createFormulaControls with intensity field: slider + number input
 * - createFormulaControls with alpha field: slider + number input
 * - createFormulaControls with hueSlot field: dropdown with available slot names
 * - createFormulaControls with hueExpression field: text input
 * - createFormulaControls with boolean field: read-only span, no interactive control
 * - createFormulaControls with structural field: "(applies on release)" note
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";

import {
  createFormulaControls,
  HUE_SLOT_OPTIONS,
  type FormulaControlsOptions,
} from "@/components/tugways/formula-editor-controls";
import type { ReverseMap } from "@/components/tugways/formula-reverse-map";
import type { FormulaRow } from "@/components/tugways/style-inspector-overlay";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock ReverseMap for testing (no real field-token entries needed). */
function mockReverseMap(): ReverseMap {
  return {
    fieldToTokens: new Map(),
    tokenToFields: new Map(),
  };
}

/** Create minimal FormulaControlsOptions with a no-op refresh. */
function mockOptions(): FormulaControlsOptions {
  return {
    reverseMap: mockReverseMap(),
    onRefresh: () => {},
  };
}

// ---------------------------------------------------------------------------
// Unit tests: createFormulaControls
// ---------------------------------------------------------------------------

describe("createFormulaControls", () => {
  it("TC1: tone field renders slider and number input", () => {
    const row: FormulaRow = {
      field: "surfaceAppTone",
      value: 8,
      property: "tone",
      isStructural: false,
    };
    const el = createFormulaControls(row, mockOptions());

    expect(el.tagName.toLowerCase()).toBe("div");
    expect(el.className).toBe("tug-formula-control");

    // Field name label
    const fieldLabel = el.querySelector(".tug-formula-control__field");
    expect(fieldLabel).not.toBeNull();
    expect(fieldLabel!.textContent).toBe("surfaceAppTone");

    // Slider
    const slider = el.querySelector("input[type='range']") as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("100");
    expect(slider.step).toBe("1");
    expect(slider.value).toBe("8");

    // Number input
    const numInput = el.querySelector("input[type='number']") as HTMLInputElement;
    expect(numInput).not.toBeNull();
    expect(numInput.value).toBe("8");
  });

  it("TC2: intensity field renders slider and number input", () => {
    const row: FormulaRow = {
      field: "surfaceAppIntensity",
      value: 3,
      property: "intensity",
      isStructural: false,
    };
    const el = createFormulaControls(row, mockOptions());

    const slider = el.querySelector("input[type='range']") as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.value).toBe("3");

    const numInput = el.querySelector("input[type='number']") as HTMLInputElement;
    expect(numInput).not.toBeNull();
    expect(numInput.value).toBe("3");
  });

  it("TC3: alpha field renders slider and number input", () => {
    const row: FormulaRow = {
      field: "shadowMdAlpha",
      value: 25,
      property: "alpha",
      isStructural: false,
    };
    const el = createFormulaControls(row, mockOptions());

    const slider = el.querySelector("input[type='range']") as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.value).toBe("25");

    const numInput = el.querySelector("input[type='number']") as HTMLInputElement;
    expect(numInput).not.toBeNull();
    expect(numInput.value).toBe("25");
  });

  it("TC4: hueSlot field renders a dropdown select with available slot names", () => {
    const row: FormulaRow = {
      field: "surfaceAppHueSlot",
      value: "frame",
      property: "hueSlot",
      isStructural: false,
    };
    const el = createFormulaControls(row, mockOptions());

    const select = el.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe("frame");

    // Should include all HUE_SLOT_OPTIONS
    const optionValues = Array.from(select.options).map((o) => o.value);
    for (const slot of HUE_SLOT_OPTIONS) {
      expect(optionValues).toContain(slot);
    }
  });

  it("TC5: hueSlot field dropdown shows currently selected value", () => {
    const row: FormulaRow = {
      field: "mutedTextHueSlot",
      value: "canvas",
      property: "hueSlot",
      isStructural: false,
    };
    const el = createFormulaControls(row, mockOptions());

    const select = el.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe("canvas");
  });

  it("TC6: boolean field renders read-only span, no interactive control", () => {
    const row: FormulaRow = {
      field: "selectionInactiveSemanticMode",
      value: true,
      property: "tone",
      isStructural: false,
    };
    const el = createFormulaControls(row, mockOptions());

    // Should have a read-only span
    const readonlySpan = el.querySelector(".tug-formula-control__readonly");
    expect(readonlySpan).not.toBeNull();
    expect(readonlySpan!.textContent).toBe("true");

    // Should NOT have slider, number input, select, or text input
    expect(el.querySelector("input[type='range']")).toBeNull();
    expect(el.querySelector("input[type='number']")).toBeNull();
    expect(el.querySelector("select")).toBeNull();
    expect(el.querySelector("input[type='text']")).toBeNull();
  });

  it("TC7: structural field renders '(applies on release)' note", () => {
    const row: FormulaRow = {
      field: "borderRadiusField",
      value: 4,
      property: "tone",
      isStructural: true,
    };
    const el = createFormulaControls(row, mockOptions());

    const note = el.querySelector(".tug-formula-control__structural-note");
    expect(note).not.toBeNull();
    expect(note!.textContent).toBe("(applies on release)");
  });

  it("TC8: non-structural field does NOT render '(applies on release)' note", () => {
    const row: FormulaRow = {
      field: "surfaceAppTone",
      value: 8,
      property: "tone",
      isStructural: false,
    };
    const el = createFormulaControls(row, mockOptions());

    const note = el.querySelector(".tug-formula-control__structural-note");
    expect(note).toBeNull();
  });

  it("TC9: string non-hueSlot field renders text input", () => {
    const row: FormulaRow = {
      field: "surfaceScreenHueExpression",
      value: "indigo",
      property: "tone",
      isStructural: false,
    };
    const el = createFormulaControls(row, mockOptions());

    const textInput = el.querySelector("input[type='text']") as HTMLInputElement;
    expect(textInput).not.toBeNull();
    expect(textInput.value).toBe("indigo");
  });

  it("TC10: hueSlot dropdown includes custom value if not in standard list", () => {
    const row: FormulaRow = {
      field: "surfaceAppHueSlot",
      value: "customSlot",
      property: "hueSlot",
      isStructural: false,
    };
    const el = createFormulaControls(row, mockOptions());

    const select = el.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe("customSlot");

    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain("customSlot");
  });

  it("TC11: slider value is rounded to nearest integer", () => {
    const row: FormulaRow = {
      field: "surfaceAppTone",
      value: 8.7,
      property: "tone",
      isStructural: false,
    };
    const el = createFormulaControls(row, mockOptions());

    const slider = el.querySelector("input[type='range']") as HTMLInputElement;
    expect(slider).not.toBeNull();
    // Math.round(8.7) = 9
    expect(slider.value).toBe("9");
  });
});
