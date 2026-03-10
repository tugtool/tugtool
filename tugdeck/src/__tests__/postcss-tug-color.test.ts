/**
 * Tests for the postcss-tug-color PostCSS plugin.
 *
 * Tests cover:
 * - Named hue expansion: --tug-color(blue, i: 5, t: 13) → oklch(0.3115 0.0143 230)
 * - Positional arguments: --tug-color(blue, 5, 13)
 * - Default arguments: --tug-color(blue) → intensity=50, tone=50
 * - Labeled arguments in any order
 * - Hue offsets: --tug-color(red+5, i: 30, t: 70)
 * - Alpha: --tug-color(blue, i: 5, t: 13, a: 50)
 * - Multiple --tug-color() calls in a single declaration value
 * - Values without --tug-color() pass through unchanged
 * - var(), rgba(), and other CSS functions pass through unmodified
 */
import { describe, it, expect } from "bun:test";

import postcss from "postcss";
import postcssTugColor from "../../postcss-tug-color";
import {
  HUE_FAMILIES,
  DEFAULT_CANONICAL_L,
  MAX_CHROMA_FOR_HUE,
  PEAK_C_SCALE,
  L_DARK,
  L_LIGHT,
  findMaxChroma,
  tugColor,
} from "@/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run the postcss-tug-color plugin on a single CSS declaration and return the expanded value. */
function processDecl(prop: string, value: string): string {
  const css = `a { ${prop}: ${value}; }`;
  const result = postcss([postcssTugColor()]).process(css, { from: undefined });
  const root = result.root;
  let expanded = value;
  root.walkDecls(prop, (decl) => {
    expanded = decl.value;
  });
  return expanded;
}

/** Parse an oklch() string into its numeric components. */
function parseOklch(s: string): { L: number; C: number; h: number; alpha?: number } | null {
  const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/);
  if (!m) return null;
  const result: { L: number; C: number; h: number; alpha?: number } = {
    L: parseFloat(m[1]),
    C: parseFloat(m[2]),
    h: parseFloat(m[3]),
  };
  if (m[4] !== undefined) result.alpha = parseFloat(m[4]);
  return result;
}

// ---------------------------------------------------------------------------
// Named hue expansion with labeled arguments
// ---------------------------------------------------------------------------

describe("postcss-tug-color: labeled argument expansion", () => {
  it("--tug-color(blue, i: 5, t: 13) expands to oklch(0.3115 0.0143 230)", () => {
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13)");
    expect(result).toBe("oklch(0.3115 0.0143 230)");
  });

  it("--tug-color(blue, i: 5, t: 13) matches tugColor() output exactly", () => {
    const expected = tugColor("blue", 5, 13, DEFAULT_CANONICAL_L["blue"]);
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13)");
    expect(result).toBe(expected);
  });

  it("labeled args in any order", () => {
    const result1 = processDecl("color", "--tug-color(c: blue, i: 5, t: 13)");
    const result2 = processDecl("color", "--tug-color(t: 13, c: blue, i: 5)");
    expect(result1).toBe(result2);
  });

  it("full label names work", () => {
    const result = processDecl("color", "--tug-color(color: blue, intensity: 5, tone: 13)");
    expect(result).toBe("oklch(0.3115 0.0143 230)");
  });
});

// ---------------------------------------------------------------------------
// Positional arguments
// ---------------------------------------------------------------------------

describe("postcss-tug-color: positional argument expansion", () => {
  it("--tug-color(blue, 5, 13) expands identically to labeled form", () => {
    const labeled = processDecl("color", "--tug-color(blue, i: 5, t: 13)");
    const positional = processDecl("color", "--tug-color(blue, 5, 13)");
    expect(positional).toBe(labeled);
  });

  it("all four positional: --tug-color(blue, 5, 13, 50)", () => {
    const result = processDecl("color", "--tug-color(blue, 5, 13, 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.alpha).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Default arguments
// ---------------------------------------------------------------------------

describe("postcss-tug-color: default arguments", () => {
  it("--tug-color(blue) uses i=50, t=50", () => {
    const result = processDecl("color", "--tug-color(blue)");
    const expected = tugColor("blue", 50, 50, DEFAULT_CANONICAL_L["blue"]);
    expect(result).toBe(expected);
  });

  it("--tug-color(blue, 20) uses t=50 default", () => {
    const result = processDecl("color", "--tug-color(blue, 20)");
    const expected = tugColor("blue", 20, 50, DEFAULT_CANONICAL_L["blue"]);
    expect(result).toBe(expected);
  });

  it("expands all 24 named hues at canonical (i=50, t=50)", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const expected = tugColor(hueName, 50, 50, canonL);
      const result = processDecl("color", `--tug-color(${hueName})`);
      expect(result).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Intensity and tone axis behavior
// ---------------------------------------------------------------------------

describe("postcss-tug-color: intensity and tone axes", () => {
  it("i=0 produces C=0 (achromatic)", () => {
    const result = processDecl("color", "--tug-color(red, i: 0, t: 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.C).toBe(0);
  });

  it("t=50 produces canonical L for each hue", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const result = processDecl("color", `--tug-color(${hueName}, i: 50, t: 50)`);
      const parsed = parseOklch(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.L).toBeCloseTo(canonL, 3);
    }
  });

  it("t=0 produces L close to L_DARK (0.15)", () => {
    const result = processDecl("color", "--tug-color(blue, i: 50, t: 0)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(L_DARK, 3);
  });

  it("t=100 produces L close to L_LIGHT (0.96)", () => {
    const result = processDecl("color", "--tug-color(blue, i: 50, t: 100)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(L_LIGHT, 3);
  });

  it("i=100 produces C = MAX_CHROMA_FOR_HUE * PEAK_C_SCALE", () => {
    const result = processDecl("color", "--tug-color(red, i: 100, t: 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    const expectedC = MAX_CHROMA_FOR_HUE["red"] * PEAK_C_SCALE;
    expect(parsed!.C).toBeCloseTo(expectedC, 4);
  });
});

// ---------------------------------------------------------------------------
// Hue offsets
// ---------------------------------------------------------------------------

describe("postcss-tug-color: hue offsets", () => {
  it("--tug-color(red+5) resolves to angle 30 (red=25, +5)", () => {
    const result = processDecl("color", "--tug-color(red+5, i: 50, t: 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.h).toBe(30);
  });

  it("--tug-color(green-10) resolves to angle 130 (green=140, -10)", () => {
    const result = processDecl("color", "--tug-color(green-10, i: 50, t: 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.h).toBe(130);
  });

  it("offset uses base hue canonical-L but dynamic peakC", () => {
    // red+5 (angle 30) should use red's canonicalL but findMaxChroma at 30
    const result = processDecl("color", "--tug-color(red+5, i: 100, t: 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    const canonL = DEFAULT_CANONICAL_L["red"] ?? 0.77;
    const expectedC = findMaxChroma(canonL, 30) * PEAK_C_SCALE;
    expect(parsed!.C).toBeCloseTo(expectedC, 4);
  });

  it("fractional offset: --tug-color(red+5.2)", () => {
    const result = processDecl("color", "--tug-color(red+5.2)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.h).toBeCloseTo(30.2, 1);
  });
});

// ---------------------------------------------------------------------------
// Alpha
// ---------------------------------------------------------------------------

describe("postcss-tug-color: alpha", () => {
  it("alpha 50 emits / 0.5", () => {
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13, a: 50)");
    expect(result).toContain("/ 0.5");
  });

  it("alpha 100 (default) emits no alpha suffix", () => {
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13)");
    expect(result).not.toContain("/");
  });

  it("alpha 0 emits / 0", () => {
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13, a: 0)");
    expect(result).toContain("/ 0");
  });

  it("fractional alpha: a: 33.333", () => {
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13, a: 33.333)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.alpha).toBeCloseTo(0.33333, 4);
  });
});

// ---------------------------------------------------------------------------
// Special colors: black and white
// ---------------------------------------------------------------------------

describe("postcss-tug-color: black and white", () => {
  it("--tug-color(black) → oklch(0 0 0)", () => {
    expect(processDecl("color", "--tug-color(black)")).toBe("oklch(0 0 0)");
  });

  it("--tug-color(white) → oklch(1 0 0)", () => {
    expect(processDecl("color", "--tug-color(white)")).toBe("oklch(1 0 0)");
  });

  it("--tug-color(black, a: 50) → oklch(0 0 0 / 0.5)", () => {
    expect(processDecl("color", "--tug-color(black, a: 50)")).toBe("oklch(0 0 0 / 0.5)");
  });

  it("--tug-color(white, a: 6) → oklch(1 0 0 / 0.06)", () => {
    expect(processDecl("color", "--tug-color(white, a: 6)")).toBe("oklch(1 0 0 / 0.06)");
  });
});

// ---------------------------------------------------------------------------
// Multiple --tug-color() calls in one declaration
// ---------------------------------------------------------------------------

describe("postcss-tug-color: multiple calls in one value", () => {
  it("two calls are both expanded", () => {
    const result = processDecl(
      "background",
      "linear-gradient(--tug-color(blue, i: 5, t: 13), --tug-color(red, i: 50, t: 50))",
    );
    expect(result).not.toContain("--tug-color(");
    expect(result).toContain("oklch(");
    const matches = result.match(/oklch\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("three calls are all expanded", () => {
    const result = processDecl(
      "background",
      "linear-gradient(--tug-color(blue, i: 5, t: 50), --tug-color(green), --tug-color(red, i: 50, t: 20))",
    );
    expect(result).not.toContain("--tug-color(");
    const matches = result.match(/oklch\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it("each expanded value matches tugColor() output", () => {
    const result = processDecl(
      "background",
      "linear-gradient(--tug-color(blue, i: 20, t: 85), --tug-color(red))",
    );
    const blueExpected = tugColor("blue", 20, 85, DEFAULT_CANONICAL_L["blue"]);
    const redExpected = tugColor("red", 50, 50, DEFAULT_CANONICAL_L["red"]);
    expect(result).toContain(blueExpected);
    expect(result).toContain(redExpected);
  });
});

// ---------------------------------------------------------------------------
// Pass-through: values without --tug-color() are unchanged
// ---------------------------------------------------------------------------

describe("postcss-tug-color: values without --tug-color() are unchanged", () => {
  it("plain hex value passes through unchanged", () => {
    expect(processDecl("color", "#3b82f6")).toBe("#3b82f6");
  });

  it("oklch() value passes through unchanged", () => {
    expect(processDecl("color", "oklch(0.5 0.1 230)")).toBe("oklch(0.5 0.1 230)");
  });

  it("named color passes through unchanged", () => {
    expect(processDecl("color", "transparent")).toBe("transparent");
  });

  it("var() reference passes through unchanged", () => {
    expect(processDecl("color", "var(--tug-blue)")).toBe("var(--tug-blue)");
  });

  it("linear-gradient() value passes through unchanged", () => {
    const value = "linear-gradient(to right, #3b82f6, white)";
    expect(processDecl("color", value)).toBe(value);
  });

  it("rgba() value passes through unchanged", () => {
    expect(processDecl("color", "rgba(0, 0, 0, 0.5)")).toBe("rgba(0, 0, 0, 0.5)");
  });
});

// ---------------------------------------------------------------------------
// CSS property variations
// ---------------------------------------------------------------------------

describe("postcss-tug-color: works on any CSS property", () => {
  it("expands --tug-color() in background-color", () => {
    const result = processDecl("background-color", "--tug-color(blue, i: 5, t: 13)");
    expect(result).toBe("oklch(0.3115 0.0143 230)");
  });

  it("expands --tug-color() in border-color", () => {
    const result = processDecl("border-color", "--tug-color(green, i: 20, t: 40)");
    expect(result).toMatch(/^oklch\(/);
    expect(result).not.toContain("--tug-color(");
  });

  it("expands --tug-color() in fill (SVG property)", () => {
    const result = processDecl("fill", "--tug-color(cherry)");
    expect(result).toMatch(/^oklch\(/);
    expect(result).not.toContain("--tug-color(");
  });
});
