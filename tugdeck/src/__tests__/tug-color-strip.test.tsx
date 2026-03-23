/**
 * TugToneStrip and TugIntensityStrip unit tests.
 *
 * Tests cover:
 * - Component render tests (renders without throwing, thumb present)
 * - Pointer event handling tests (onChange called)
 * - valueFromPointerX boundary tests (0 at left, 100 at right, clamps)
 * - themeColorSpecToOklch format test (returns oklch(...) format)
 * - Gradient string format (linear-gradient, oklch stops)
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
import { themeColorSpecToOklch, type ThemeSpec } from "@/components/tugways/theme-engine";
import brioJson from "../../themes/brio.json";

const brio = brioJson as ThemeSpec;

// ---------------------------------------------------------------------------
// buildToneGradient / buildIntensityGradient — format tests only
// ---------------------------------------------------------------------------

describe("buildToneGradient – gradient string format", () => {
  it("returns a linear-gradient string", () => {
    expect(buildToneGradient("blue", 50)).toMatch(/^linear-gradient\(to right,/);
  });

  it("contains oklch() color stops", () => {
    expect(buildToneGradient("blue", 50)).toMatch(/oklch\(/);
  });

  it("handles compound hue name 'indigo-violet' without throwing", () => {
    expect(() => buildToneGradient("indigo-violet", 40)).not.toThrow();
  });
});

describe("buildIntensityGradient – gradient string format", () => {
  it("returns a linear-gradient string", () => {
    expect(buildIntensityGradient("blue", 50)).toMatch(/^linear-gradient\(to right,/);
  });

  it("contains oklch() color stops", () => {
    expect(buildIntensityGradient("blue", 50)).toMatch(/oklch\(/);
  });

  it("handles compound hue name 'indigo-violet' without throwing", () => {
    expect(() => buildIntensityGradient("indigo-violet", 50)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// valueFromPointerX – boundary and clamp tests
// ---------------------------------------------------------------------------

describe("valueFromPointerX – pointer position to 0-100 value", () => {
  function makeEl(left: number, width: number): HTMLElement {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      left,
      width,
      top: 0,
      right: left + width,
      bottom: 28,
      height: 28,
      x: left,
      y: 0,
      toJSON: () => {},
    });
    return el;
  }

  it("returns 0 at the left edge", () => {
    expect(valueFromPointerX(makeEl(100, 200), 100)).toBe(0);
  });

  it("returns 100 at the right edge", () => {
    expect(valueFromPointerX(makeEl(100, 200), 300)).toBe(100);
  });

  it("returns 50 at the center", () => {
    expect(valueFromPointerX(makeEl(100, 200), 200)).toBe(50);
  });

  it("clamps to 0 when pointer is left of the strip", () => {
    expect(valueFromPointerX(makeEl(100, 200), 50)).toBe(0);
  });

  it("clamps to 100 when pointer is right of the strip", () => {
    expect(valueFromPointerX(makeEl(100, 200), 400)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// TugToneStrip component tests
// ---------------------------------------------------------------------------

describe("TugToneStrip – render", () => {
  afterEach(() => { cleanup(); });

  it("renders without throwing", () => {
    expect(() => {
      act(() => {
        render(<TugToneStrip hue="blue" intensity={50} value={30} onChange={() => {}} data-testid="tone-strip" />);
      });
    }).not.toThrow();
  });

  it("renders a thumb indicator", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<TugToneStrip hue="blue" intensity={50} value={75} onChange={() => {}} data-testid="tone-strip" />));
    });
    expect(container.querySelector("[data-testid='tone-strip-thumb']")).not.toBeNull();
  });

  it("calls onChange when pointerdown fires on the strip", () => {
    const handler = mock((_v: number) => {});
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<TugToneStrip hue="blue" intensity={50} value={50} onChange={handler} data-testid="tone-strip" />));
    });
    const strip = container.querySelector("[data-testid='tone-strip']") as HTMLElement;
    act(() => { fireEvent.pointerDown(strip, { clientX: 0, pointerId: 1 }); });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// TugIntensityStrip component tests
// ---------------------------------------------------------------------------

describe("TugIntensityStrip – render", () => {
  afterEach(() => { cleanup(); });

  it("renders without throwing", () => {
    expect(() => {
      act(() => {
        render(<TugIntensityStrip hue="blue" tone={50} value={30} onChange={() => {}} data-testid="intensity-strip" />);
      });
    }).not.toThrow();
  });

  it("renders a thumb indicator", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<TugIntensityStrip hue="blue" tone={50} value={80} onChange={() => {}} data-testid="intensity-strip" />));
    });
    expect(container.querySelector("[data-testid='intensity-strip-thumb']")).not.toBeNull();
  });

  it("calls onChange when pointerdown fires on the strip", () => {
    const handler = mock((_v: number) => {});
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<TugIntensityStrip hue="blue" tone={50} value={50} onChange={handler} data-testid="intensity-strip" />));
    });
    const strip = container.querySelector("[data-testid='intensity-strip']") as HTMLElement;
    act(() => { fireEvent.pointerDown(strip, { clientX: 0, pointerId: 1 }); });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// themeColorSpecToOklch – format test (ONE test, not five)
// ---------------------------------------------------------------------------

describe("themeColorSpecToOklch – oklch() CSS string from ThemeColorSpec", () => {
  it("returns a string matching oklch() format for a simple hue name", () => {
    const result = themeColorSpecToOklch({ hue: "blue", tone: 50, intensity: 50 });
    expect(result).toMatch(/^oklch\(\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?\)$/);
  });

  it("handles compound hue name 'indigo-violet' without throwing", () => {
    expect(() => themeColorSpecToOklch({ hue: "indigo-violet", tone: 12, intensity: 4 })).not.toThrow();
  });

  it("brio grid spec produces a valid oklch() string without NaN", () => {
    const result = themeColorSpecToOklch(brio.surface.grid);
    expect(result).toMatch(/^oklch\(/);
    expect(result).not.toContain("NaN");
  });
});
