/**
 * TugToneStrip and TugIntensityStrip unit tests.
 *
 * Tests cover:
 * - TugToneStrip renders with correct gradient stops for a given hue/intensity
 * - TugIntensityStrip renders with correct gradient stops for a given hue/tone
 * - Pointer events compute correct value from position (via valueFromPointerX)
 * - Compound hue names ("indigo-violet") resolve correctly
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import {
  TugToneStrip,
  TugIntensityStrip,
  buildToneGradient,
  buildIntensityGradient,
  valueFromPointerX,
} from "@/components/tugways/tug-color-strip";
import { HUE_FAMILIES, MAX_CHROMA_FOR_HUE, PEAK_C_SCALE, resolveHyphenatedHue } from "@/components/tugways/palette-engine";
import { themeColorSpecToOklch, EXAMPLE_RECIPES } from "@/components/tugways/theme-engine";

// ---------------------------------------------------------------------------
// buildToneGradient unit tests
// ---------------------------------------------------------------------------

describe("buildToneGradient – gradient string format", () => {
  it("returns a linear-gradient string", () => {
    const gradient = buildToneGradient("blue", 50);
    expect(gradient).toMatch(/^linear-gradient\(to right,/);
  });

  it("contains oklch() color stops", () => {
    const gradient = buildToneGradient("blue", 50);
    expect(gradient).toMatch(/oklch\(/);
  });

  it("contains 11 color stops", () => {
    const gradient = buildToneGradient("cobalt", 30);
    // Each stop is an oklch(...) value
    const matches = gradient.match(/oklch\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(11);
  });

  it("uses the hue angle from HUE_FAMILIES for the given hue", () => {
    const hue = "cobalt";
    const angle = HUE_FAMILIES[hue];
    const gradient = buildToneGradient(hue, 50);
    // The hue angle should appear in the gradient stops
    expect(gradient).toContain(` ${angle})`);
  });

  it("produces zero chroma stops at intensity 0 (achromatic)", () => {
    const gradient = buildToneGradient("blue", 0);
    // All stops should have C = 0
    const stops = gradient.match(/oklch\([^)]+\)/g)!;
    for (const stop of stops) {
      // format: oklch(L C H) — parse C value
      const parts = stop.replace("oklch(", "").replace(")", "").trim().split(" ");
      expect(parseFloat(parts[1])).toBe(0);
    }
  });

  it("handles compound hue name 'indigo-violet' without throwing", () => {
    expect(() => buildToneGradient("indigo-violet", 40)).not.toThrow();
  });

  it("compound hue 'indigo-violet' uses indigo's angle (primary fallback)", () => {
    const gradient = buildToneGradient("indigo-violet", 50);
    // "indigo-violet" is a known compound in HUE_FAMILIES; if not, falls back to "indigo"
    const expectedAngle =
      HUE_FAMILIES["indigo-violet"] ?? HUE_FAMILIES["indigo"];
    expect(gradient).toContain(` ${expectedAngle})`);
  });
});

// ---------------------------------------------------------------------------
// buildIntensityGradient unit tests
// ---------------------------------------------------------------------------

describe("buildIntensityGradient – gradient string format", () => {
  it("returns a linear-gradient string", () => {
    const gradient = buildIntensityGradient("blue", 50);
    expect(gradient).toMatch(/^linear-gradient\(to right,/);
  });

  it("contains oklch() color stops", () => {
    const gradient = buildIntensityGradient("blue", 50);
    expect(gradient).toMatch(/oklch\(/);
  });

  it("contains 11 color stops", () => {
    const gradient = buildIntensityGradient("cobalt", 30);
    const matches = gradient.match(/oklch\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(11);
  });

  it("first stop is achromatic (C = 0)", () => {
    const gradient = buildIntensityGradient("blue", 50);
    // First stop: intensity 0 => C = 0
    const firstStop = gradient.match(/oklch\([^)]+\)/)![0];
    const parts = firstStop.replace("oklch(", "").replace(")", "").trim().split(" ");
    expect(parseFloat(parts[1])).toBe(0);
  });

  it("last stop has maximum chroma (peakC for the hue)", () => {
    const hue = "blue";
    const maxC = MAX_CHROMA_FOR_HUE[hue];
    const peakC = maxC * PEAK_C_SCALE;
    const gradient = buildIntensityGradient(hue, 50);
    // Last stop: intensity 100 => C = peakC
    const stops = gradient.match(/oklch\([^)]+\)/g)!;
    const lastStop = stops[stops.length - 1];
    const parts = lastStop.replace("oklch(", "").replace(")", "").trim().split(" ");
    const c = parseFloat(parts[1]);
    expect(c).toBeCloseTo(peakC, 3);
  });

  it("handles compound hue name 'indigo-violet' without throwing", () => {
    expect(() => buildIntensityGradient("indigo-violet", 50)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// valueFromPointerX unit tests
// ---------------------------------------------------------------------------

describe("valueFromPointerX – pointer position to 0-100 value", () => {
  it("returns 0 at the left edge", () => {
    const el = document.createElement("div");
    // Mock getBoundingClientRect
    el.getBoundingClientRect = () => ({
      left: 100,
      width: 200,
      top: 0,
      right: 300,
      bottom: 28,
      height: 28,
      x: 100,
      y: 0,
      toJSON: () => {},
    });
    expect(valueFromPointerX(el, 100)).toBe(0);
  });

  it("returns 100 at the right edge", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      left: 100,
      width: 200,
      top: 0,
      right: 300,
      bottom: 28,
      height: 28,
      x: 100,
      y: 0,
      toJSON: () => {},
    });
    expect(valueFromPointerX(el, 300)).toBe(100);
  });

  it("returns 50 at the center", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      left: 100,
      width: 200,
      top: 0,
      right: 300,
      bottom: 28,
      height: 28,
      x: 100,
      y: 0,
      toJSON: () => {},
    });
    expect(valueFromPointerX(el, 200)).toBe(50);
  });

  it("clamps to 0 when pointer is left of the strip", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      left: 100,
      width: 200,
      top: 0,
      right: 300,
      bottom: 28,
      height: 28,
      x: 100,
      y: 0,
      toJSON: () => {},
    });
    expect(valueFromPointerX(el, 50)).toBe(0);
  });

  it("clamps to 100 when pointer is right of the strip", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      left: 100,
      width: 200,
      top: 0,
      right: 300,
      bottom: 28,
      height: 28,
      x: 100,
      y: 0,
      toJSON: () => {},
    });
    expect(valueFromPointerX(el, 400)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// TugToneStrip component tests
// ---------------------------------------------------------------------------

describe("TugToneStrip – render", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders without throwing", () => {
    expect(() => {
      act(() => {
        render(
          <TugToneStrip
            hue="blue"
            intensity={50}
            value={30}
            onChange={() => {}}
            data-testid="tone-strip"
          />,
        );
      });
    }).not.toThrow();
  });

  it("renders the strip container with the gradient in data-gradient", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <TugToneStrip
          hue="cobalt"
          intensity={40}
          value={20}
          onChange={() => {}}
          data-testid="tone-strip"
        />,
      ));
    });
    const strip = container.querySelector("[data-testid='tone-strip']") as HTMLElement;
    expect(strip).not.toBeNull();
    const gradient = strip.getAttribute("data-gradient") ?? "";
    expect(gradient).toMatch(/^linear-gradient\(to right,/);
    expect(gradient).toContain("oklch(");
  });

  it("renders a thumb indicator", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <TugToneStrip
          hue="blue"
          intensity={50}
          value={75}
          onChange={() => {}}
          data-testid="tone-strip"
        />,
      ));
    });
    const thumb = container.querySelector("[data-testid='tone-strip-thumb']");
    expect(thumb).not.toBeNull();
  });

  it("calls onChange when pointerdown fires on the strip", () => {
    const handler = mock((_v: number) => {});
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <TugToneStrip
          hue="blue"
          intensity={50}
          value={50}
          onChange={handler}
          data-testid="tone-strip"
        />,
      ));
    });
    const strip = container.querySelector("[data-testid='tone-strip']") as HTMLElement;
    expect(strip).not.toBeNull();
    // Simulate pointerdown — onChange should be called
    act(() => {
      fireEvent.pointerDown(strip, { clientX: 0, pointerId: 1 });
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// TugIntensityStrip component tests
// ---------------------------------------------------------------------------

describe("TugIntensityStrip – render", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders without throwing", () => {
    expect(() => {
      act(() => {
        render(
          <TugIntensityStrip
            hue="blue"
            tone={50}
            value={30}
            onChange={() => {}}
            data-testid="intensity-strip"
          />,
        );
      });
    }).not.toThrow();
  });

  it("renders the strip container with gradient in data-gradient", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <TugIntensityStrip
          hue="cobalt"
          tone={30}
          value={60}
          onChange={() => {}}
          data-testid="intensity-strip"
        />,
      ));
    });
    const strip = container.querySelector("[data-testid='intensity-strip']") as HTMLElement;
    expect(strip).not.toBeNull();
    const gradient = strip.getAttribute("data-gradient") ?? "";
    expect(gradient).toMatch(/^linear-gradient\(to right,/);
    expect(gradient).toContain("oklch(");
  });

  it("renders a thumb indicator", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <TugIntensityStrip
          hue="blue"
          tone={50}
          value={80}
          onChange={() => {}}
          data-testid="intensity-strip"
        />,
      ));
    });
    const thumb = container.querySelector(
      "[data-testid='intensity-strip-thumb']",
    );
    expect(thumb).not.toBeNull();
  });

  it("calls onChange when pointerdown fires on the strip", () => {
    const handler = mock((_v: number) => {});
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <TugIntensityStrip
          hue="blue"
          tone={50}
          value={50}
          onChange={handler}
          data-testid="intensity-strip"
        />,
      ));
    });
    const strip = container.querySelector(
      "[data-testid='intensity-strip']",
    ) as HTMLElement;
    expect(strip).not.toBeNull();
    act(() => {
      fireEvent.pointerDown(strip, { clientX: 0, pointerId: 1 });
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// themeColorSpecToOklch unit tests [D06]
// ---------------------------------------------------------------------------

describe("themeColorSpecToOklch – oklch() CSS string from ThemeColorSpec", () => {
  it("returns a string matching oklch() format for a simple hue name", () => {
    const result = themeColorSpecToOklch({ hue: "blue", tone: 50, intensity: 50 });
    expect(result).toMatch(/^oklch\(\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?\)$/);
  });

  it("uses the correct hue angle from HUE_FAMILIES for 'blue'", () => {
    const result = themeColorSpecToOklch({ hue: "blue", tone: 50, intensity: 50 });
    const angle = HUE_FAMILIES["blue"];
    expect(result).toContain(` ${angle})`);
  });

  it("intensity 0 produces C = 0 (achromatic)", () => {
    const result = themeColorSpecToOklch({ hue: "blue", tone: 50, intensity: 0 });
    const parts = result.replace("oklch(", "").replace(")", "").trim().split(" ");
    expect(parseFloat(parts[1])).toBe(0);
  });

  it("intensity 100 produces maximum chroma for the hue", () => {
    const hue = "blue";
    const maxC = MAX_CHROMA_FOR_HUE[hue];
    const expected = maxC * PEAK_C_SCALE;
    const result = themeColorSpecToOklch({ hue, tone: 50, intensity: 100 });
    const parts = result.replace("oklch(", "").replace(")", "").trim().split(" ");
    expect(parseFloat(parts[1])).toBeCloseTo(expected, 3);
  });

  it("handles compound hue name 'indigo-violet' without throwing", () => {
    expect(() => themeColorSpecToOklch({ hue: "indigo-violet", tone: 12, intensity: 4 })).not.toThrow();
  });

  it("compound hue 'indigo-violet' uses the correct blended hue angle", () => {
    const result = themeColorSpecToOklch({ hue: "indigo-violet", tone: 12, intensity: 4 });
    // "indigo-violet" blends indigo (260) and violet (270) via resolveHyphenatedHue
    const expectedAngle = resolveHyphenatedHue("indigo", "violet");
    expect(result).toContain(` ${expectedAngle})`);
  });

  it("brio grid spec (indigo-violet, tone 12, intensity 4) produces a valid oklch() string", () => {
    const spec = EXAMPLE_RECIPES.brio.surface.grid;
    const result = themeColorSpecToOklch(spec);
    expect(result).toMatch(/^oklch\(/);
    expect(result).not.toContain("NaN");
  });

  it("harmony grid spec (indigo-violet, tone 88, intensity 5) produces a valid oklch() string", () => {
    const spec = EXAMPLE_RECIPES.harmony.surface.grid;
    const result = themeColorSpecToOklch(spec);
    expect(result).toMatch(/^oklch\(/);
    expect(result).not.toContain("NaN");
  });

  it("brio grid spec produces a darker color than harmony grid spec (lower L)", () => {
    const brioResult = themeColorSpecToOklch(EXAMPLE_RECIPES.brio.surface.grid);
    const harmonyResult = themeColorSpecToOklch(EXAMPLE_RECIPES.harmony.surface.grid);
    const brioL = parseFloat(brioResult.replace("oklch(", "").split(" ")[0]);
    const harmonyL = parseFloat(harmonyResult.replace("oklch(", "").split(" ")[0]);
    // Brio tone 12 should be darker (lower L) than harmony tone 88
    expect(brioL).toBeLessThan(harmonyL);
  });
});
