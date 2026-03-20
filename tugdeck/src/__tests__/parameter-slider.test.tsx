/**
 * parameter-slider tests — Step 1 of tugplan-recipe-authoring-ui.
 *
 * Tests cover:
 * - T1.1: ParameterSlider renders label, low/high descriptions, and numeric value for each parameter.
 * - T1.2: Slider onChange callback fires with correct (paramKey, value) tuple.
 * - T1.3: Range input has correct min/max/step attributes.
 * - Additional: PARAMETER_METADATA contains all 7 expected entries.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, afterEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

import {
  ParameterSlider,
  PARAMETER_METADATA,
  type ParameterSliderProps,
} from "@/components/tugways/parameter-slider";
import type { RecipeParameters } from "@/components/tugways/recipe-parameters";

// ---------------------------------------------------------------------------
// PARAMETER_METADATA — structural verification
// ---------------------------------------------------------------------------

describe("PARAMETER_METADATA", () => {
  it("contains exactly 7 entries", () => {
    expect(PARAMETER_METADATA.length).toBe(7);
  });

  it("covers all 7 RecipeParameters keys", () => {
    const keys = PARAMETER_METADATA.map((m) => m.paramKey);
    const expected: Array<keyof RecipeParameters> = [
      "surfaceDepth",
      "textHierarchy",
      "controlWeight",
      "borderDefinition",
      "shadowDepth",
      "signalStrength",
      "atmosphere",
    ];
    for (const key of expected) {
      expect(keys).toContain(key);
    }
  });

  it("all entries have non-empty label, lowLabel, and highLabel", () => {
    for (const entry of PARAMETER_METADATA) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.lowLabel.length).toBeGreaterThan(0);
      expect(entry.highLabel.length).toBeGreaterThan(0);
    }
  });

  it("has correct labels per Spec S02", () => {
    const find = (key: keyof RecipeParameters) =>
      PARAMETER_METADATA.find((m) => m.paramKey === key)!;

    expect(find("surfaceDepth").label).toBe("Surface Depth");
    expect(find("surfaceDepth").lowLabel).toBe("Flat");
    expect(find("surfaceDepth").highLabel).toBe("Deep");

    expect(find("textHierarchy").label).toBe("Text Hierarchy");
    expect(find("textHierarchy").lowLabel).toBe("Democratic");
    expect(find("textHierarchy").highLabel).toBe("Strong order");

    expect(find("controlWeight").label).toBe("Control Weight");
    expect(find("controlWeight").lowLabel).toBe("Light");
    expect(find("controlWeight").highLabel).toBe("Bold");

    expect(find("borderDefinition").label).toBe("Border Definition");
    expect(find("borderDefinition").lowLabel).toBe("Minimal");
    expect(find("borderDefinition").highLabel).toBe("Strong");

    expect(find("shadowDepth").label).toBe("Shadow Depth");
    expect(find("shadowDepth").lowLabel).toBe("Flat");
    expect(find("shadowDepth").highLabel).toBe("Deep");

    expect(find("signalStrength").label).toBe("Signal Strength");
    expect(find("signalStrength").lowLabel).toBe("Muted");
    expect(find("signalStrength").highLabel).toBe("Vivid");

    expect(find("atmosphere").label).toBe("Atmosphere");
    expect(find("atmosphere").lowLabel).toBe("Achromatic");
    expect(find("atmosphere").highLabel).toBe("Tinted");
  });
});

// ---------------------------------------------------------------------------
// T1.1: ParameterSlider renders label, low/high descriptions, numeric value
// ---------------------------------------------------------------------------

describe("ParameterSlider – T1.1: renders label, low/high labels, and numeric value", () => {
  it("renders all 7 sliders from PARAMETER_METADATA without error", () => {
    const onChange = mock((_key: keyof RecipeParameters, _val: number) => {});

    for (const meta of PARAMETER_METADATA) {
      const { unmount, getByTestId } = render(
        <ParameterSlider
          paramKey={meta.paramKey}
          label={meta.label}
          lowLabel={meta.lowLabel}
          highLabel={meta.highLabel}
          value={50}
          onChange={onChange}
        />,
      );

      // Container
      const container = getByTestId(`parameter-slider-${meta.paramKey}`);
      expect(container).not.toBeNull();

      // Label
      const labelEl = getByTestId(`ps-label-${meta.paramKey}`);
      expect(labelEl.textContent).toBe(meta.label);

      // Low label
      const lowEl = getByTestId(`ps-low-label-${meta.paramKey}`);
      expect(lowEl.textContent).toBe(meta.lowLabel);

      // High label
      const highEl = getByTestId(`ps-high-label-${meta.paramKey}`);
      expect(highEl.textContent).toBe(meta.highLabel);

      // Numeric value
      const valueEl = getByTestId(`ps-value-${meta.paramKey}`);
      expect(valueEl.textContent).toBe("50");

      unmount();
    }
  });

  it("displays the provided numeric value", () => {
    const onChange = mock((_key: keyof RecipeParameters, _val: number) => {});
    const { getByTestId } = render(
      <ParameterSlider
        paramKey="surfaceDepth"
        label="Surface Depth"
        lowLabel="Flat"
        highLabel="Deep"
        value={75}
        onChange={onChange}
      />,
    );

    const valueEl = getByTestId("ps-value-surfaceDepth");
    expect(valueEl.textContent).toBe("75");
  });

  it("displays value=0 correctly", () => {
    const onChange = mock((_key: keyof RecipeParameters, _val: number) => {});
    const { getByTestId } = render(
      <ParameterSlider
        paramKey="atmosphere"
        label="Atmosphere"
        lowLabel="Achromatic"
        highLabel="Tinted"
        value={0}
        onChange={onChange}
      />,
    );

    expect(getByTestId("ps-value-atmosphere").textContent).toBe("0");
  });

  it("displays value=100 correctly", () => {
    const onChange = mock((_key: keyof RecipeParameters, _val: number) => {});
    const { getByTestId } = render(
      <ParameterSlider
        paramKey="signalStrength"
        label="Signal Strength"
        lowLabel="Muted"
        highLabel="Vivid"
        value={100}
        onChange={onChange}
      />,
    );

    expect(getByTestId("ps-value-signalStrength").textContent).toBe("100");
  });
});

// ---------------------------------------------------------------------------
// T1.2: onChange callback fires with correct (paramKey, value) tuple
// ---------------------------------------------------------------------------

describe("ParameterSlider – T1.2: onChange fires with correct (paramKey, value)", () => {
  it("calls onChange with the correct paramKey and numeric value on input event", () => {
    const onChange = mock((_key: keyof RecipeParameters, _val: number) => {});

    const { getByTestId } = render(
      <ParameterSlider
        paramKey="textHierarchy"
        label="Text Hierarchy"
        lowLabel="Democratic"
        highLabel="Strong order"
        value={50}
        onChange={onChange}
      />,
    );

    const rangeInput = getByTestId("ps-range-textHierarchy") as HTMLInputElement;

    // Simulate input event with new value
    fireEvent.input(rangeInput, { target: { value: "80" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [calledKey, calledVal] = onChange.mock.calls[0] as [keyof RecipeParameters, number];
    expect(calledKey).toBe("textHierarchy");
    expect(calledVal).toBe(80);
  });

  it("calls onChange for each of the 7 parameter keys", () => {
    for (const meta of PARAMETER_METADATA) {
      const onChange = mock((_key: keyof RecipeParameters, _val: number) => {});

      const { getByTestId, unmount } = render(
        <ParameterSlider
          paramKey={meta.paramKey}
          label={meta.label}
          lowLabel={meta.lowLabel}
          highLabel={meta.highLabel}
          value={50}
          onChange={onChange}
        />,
      );

      const rangeInput = getByTestId(`ps-range-${meta.paramKey}`) as HTMLInputElement;
      fireEvent.input(rangeInput, { target: { value: "30" } });

      expect(onChange).toHaveBeenCalledTimes(1);
      const [calledKey, calledVal] = onChange.mock.calls[0] as [keyof RecipeParameters, number];
      expect(calledKey).toBe(meta.paramKey);
      expect(calledVal).toBe(30);

      unmount();
    }
  });

  it("passes the numeric value (not string) to onChange", () => {
    const onChange = mock((_key: keyof RecipeParameters, _val: number) => {});

    const { getByTestId } = render(
      <ParameterSlider
        paramKey="shadowDepth"
        label="Shadow Depth"
        lowLabel="Flat"
        highLabel="Deep"
        value={50}
        onChange={onChange}
      />,
    );

    const rangeInput = getByTestId("ps-range-shadowDepth") as HTMLInputElement;
    fireEvent.input(rangeInput, { target: { value: "42" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [, calledVal] = onChange.mock.calls[0] as [keyof RecipeParameters, number];
    expect(typeof calledVal).toBe("number");
    expect(calledVal).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// T1.3: Range input has correct min/max/step attributes
// ---------------------------------------------------------------------------

describe("ParameterSlider – T1.3: range input has correct min/max/step attributes", () => {
  function renderSlider(overrides: Partial<ParameterSliderProps> = {}) {
    const defaults: ParameterSliderProps = {
      paramKey: "controlWeight",
      label: "Control Weight",
      lowLabel: "Light",
      highLabel: "Bold",
      value: 50,
      onChange: mock(() => {}),
    };
    return render(<ParameterSlider {...defaults} {...overrides} />);
  }

  it("has min=0", () => {
    const { getByTestId } = renderSlider();
    const input = getByTestId("ps-range-controlWeight") as HTMLInputElement;
    expect(input.min).toBe("0");
  });

  it("has max=100", () => {
    const { getByTestId } = renderSlider();
    const input = getByTestId("ps-range-controlWeight") as HTMLInputElement;
    expect(input.max).toBe("100");
  });

  it("has step=1", () => {
    const { getByTestId } = renderSlider();
    const input = getByTestId("ps-range-controlWeight") as HTMLInputElement;
    expect(input.step).toBe("1");
  });

  it("has type=range", () => {
    const { getByTestId } = renderSlider();
    const input = getByTestId("ps-range-controlWeight") as HTMLInputElement;
    expect(input.type).toBe("range");
  });

  it("reflects the value prop in the input", () => {
    const { getByTestId } = renderSlider({ value: 77 });
    const input = getByTestId("ps-range-controlWeight") as HTMLInputElement;
    expect(input.value).toBe("77");
  });

  it("all 7 sliders have correct min/max/step", () => {
    const onChange = mock((_key: keyof RecipeParameters, _val: number) => {});

    for (const meta of PARAMETER_METADATA) {
      const { getByTestId, unmount } = render(
        <ParameterSlider
          paramKey={meta.paramKey}
          label={meta.label}
          lowLabel={meta.lowLabel}
          highLabel={meta.highLabel}
          value={50}
          onChange={onChange}
        />,
      );

      const input = getByTestId(`ps-range-${meta.paramKey}`) as HTMLInputElement;
      expect(input.type).toBe("range");
      expect(input.min).toBe("0");
      expect(input.max).toBe("100");
      expect(input.step).toBe("1");

      unmount();
    }
  });
});
