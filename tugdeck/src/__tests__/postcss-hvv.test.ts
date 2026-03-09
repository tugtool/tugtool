/**
 * Tests for the postcss-hvv PostCSS plugin.
 *
 * Tests cover:
 * - Named hue expansion: --hvv(blue, 5, 13) → oklch(0.3115 0.0143 230)
 * - Raw angle expansion: --hvv(237, 5, 13) → correct oklch()
 * - Multiple --hvv() calls in a single declaration value
 * - Values without --hvv() pass through unchanged
 * - var(), color-mix(), rgba() values pass through unmodified
 */
import { describe, it, expect } from "bun:test";

import postcss from "postcss";
import postcssHvv from "../../postcss-hvv";
import {
  HUE_FAMILIES,
  DEFAULT_CANONICAL_L,
  MAX_CHROMA_FOR_HUE,
  PEAK_C_SCALE,
  L_DARK,
  L_LIGHT,
  findMaxChroma,
  hvvColor,
} from "@/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run the postcss-hvv plugin on a single CSS declaration and return the expanded value. */
function processDecl(prop: string, value: string): string {
  const css = `a { ${prop}: ${value}; }`;
  const result = postcss([postcssHvv()]).process(css, { from: undefined });
  const root = result.root;
  let expanded = value;
  root.walkDecls(prop, (decl) => {
    expanded = decl.value;
  });
  return expanded;
}

/** Parse an oklch() string into its numeric components. */
function parseOklch(s: string): { L: number; C: number; h: number } | null {
  const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!m) return null;
  return { L: parseFloat(m[1]), C: parseFloat(m[2]), h: parseFloat(m[3]) };
}

// ---------------------------------------------------------------------------
// Named hue expansion
// ---------------------------------------------------------------------------

describe("postcss-hvv: named hue expansion", () => {
  it("--hvv(blue, 5, 13) expands to oklch(0.3115 0.0143 230)", () => {
    // L = 0.15 + 13 * (0.771 - 0.15) / 50 = 0.15 + 13 * 0.621 / 50 = 0.15 + 0.16146 = 0.31146 → 0.3115
    // C = (5/100) * (0.143 * 2) = 0.05 * 0.286 = 0.0143
    const result = processDecl("color", "--hvv(blue, 5, 13)");
    expect(result).toBe("oklch(0.3115 0.0143 230)");
  });

  it("--hvv(blue, 5, 13) matches hvvColor() output exactly", () => {
    const expected = hvvColor("blue", 5, 13, DEFAULT_CANONICAL_L["blue"]);
    const result = processDecl("color", "--hvv(blue, 5, 13)");
    expect(result).toBe(expected);
  });

  it("expands all 24 named hues at canonical (vib=50, val=50)", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const expected = hvvColor(hueName, 50, 50, canonL);
      const result = processDecl("color", `--hvv(${hueName}, 50, 50)`);
      expect(result).toBe(expected);
    }
  });

  it("vib=0 produces C=0 (achromatic)", () => {
    const result = processDecl("color", "--hvv(red, 0, 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.C).toBe(0);
  });

  it("val=50 produces canonical L for each hue", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const result = processDecl("color", `--hvv(${hueName}, 50, 50)`);
      const parsed = parseOklch(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.L).toBeCloseTo(canonL, 3);
    }
  });

  it("val=0 produces L close to L_DARK (0.15)", () => {
    const result = processDecl("color", "--hvv(blue, 50, 0)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(L_DARK, 3);
  });

  it("val=100 produces L close to L_LIGHT (0.96)", () => {
    const result = processDecl("color", "--hvv(blue, 50, 100)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(L_LIGHT, 3);
  });

  it("vib=100 produces C = MAX_CHROMA_FOR_HUE * PEAK_C_SCALE", () => {
    const result = processDecl("color", "--hvv(red, 100, 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    const expectedC = MAX_CHROMA_FOR_HUE["red"] * PEAK_C_SCALE;
    expect(parsed!.C).toBeCloseTo(expectedC, 4);
  });
});

// ---------------------------------------------------------------------------
// Raw numeric angle expansion
// ---------------------------------------------------------------------------

describe("postcss-hvv: raw numeric angle expansion", () => {
  it("--hvv(237, 5, 13) expands to a valid oklch() string", () => {
    const result = processDecl("color", "--hvv(237, 5, 13)");
    expect(result).toMatch(/^oklch\([\d.]+ [\d.]+ 237\)$/);
  });

  it("--hvv(237, 5, 13) uses hue angle 237 in output", () => {
    const result = processDecl("color", "--hvv(237, 5, 13)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.h).toBe(237);
  });

  it("raw angle uses findMaxChroma() at canonicalL=0.77", () => {
    // Compute expected C using the same formula as the plugin
    const canonicalL = 0.77;
    const maxC = findMaxChroma(canonicalL, 237);
    const peakC = maxC * PEAK_C_SCALE;
    const expectedC = parseFloat(((5 / 100) * peakC).toFixed(4));
    const result = processDecl("color", "--hvv(237, 5, 13)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.C).toBeCloseTo(expectedC, 4);
  });

  it("raw angle 0 expands without error", () => {
    const result = processDecl("color", "--hvv(0, 50, 50)");
    expect(result).toMatch(/^oklch\(/);
  });

  it("raw angle 360 expands without error", () => {
    const result = processDecl("color", "--hvv(360, 50, 50)");
    expect(result).toMatch(/^oklch\(/);
  });
});

// ---------------------------------------------------------------------------
// Multiple --hvv() calls in one declaration
// ---------------------------------------------------------------------------

describe("postcss-hvv: multiple --hvv() calls in one value", () => {
  it("both calls are expanded when two --hvv() appear in one value", () => {
    const result = processDecl(
      "background",
      "linear-gradient(--hvv(blue, 5, 13), --hvv(red, 50, 50))",
    );
    expect(result).not.toContain("--hvv(");
    expect(result).toContain("oklch(");
    const matches = result.match(/oklch\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("three --hvv() calls in one value are all expanded", () => {
    const result = processDecl(
      "background",
      "linear-gradient(--hvv(blue, 5, 50), --hvv(green, 50, 50), --hvv(red, 50, 20))",
    );
    expect(result).not.toContain("--hvv(");
    const matches = result.match(/oklch\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it("each expanded value matches hvvColor() output", () => {
    const result = processDecl(
      "background",
      "linear-gradient(--hvv(blue, 20, 85), --hvv(red, 50, 50))",
    );
    const blueExpected = hvvColor("blue", 20, 85, DEFAULT_CANONICAL_L["blue"]);
    const redExpected = hvvColor("red", 50, 50, DEFAULT_CANONICAL_L["red"]);
    expect(result).toContain(blueExpected);
    expect(result).toContain(redExpected);
  });
});

// ---------------------------------------------------------------------------
// Pass-through: values without --hvv() are unchanged
// ---------------------------------------------------------------------------

describe("postcss-hvv: values without --hvv() are unchanged", () => {
  it("plain hex value passes through unchanged", () => {
    const value = "#3b82f6";
    expect(processDecl("color", value)).toBe(value);
  });

  it("oklch() value passes through unchanged", () => {
    const value = "oklch(0.5 0.1 230)";
    expect(processDecl("color", value)).toBe(value);
  });

  it("named color passes through unchanged", () => {
    const value = "transparent";
    expect(processDecl("color", value)).toBe(value);
  });

  it("var() reference passes through unchanged", () => {
    const value = "var(--tug-blue)";
    expect(processDecl("color", value)).toBe(value);
  });

  it("var() with fallback passes through unchanged", () => {
    const value = "var(--my-color, oklch(0.5 0.1 230))";
    expect(processDecl("color", value)).toBe(value);
  });

  it("color-mix() value passes through unchanged", () => {
    const value = "color-mix(in oklch, #3b82f6 50%, white)";
    expect(processDecl("color", value)).toBe(value);
  });

  it("rgba() value passes through unchanged", () => {
    const value = "rgba(0, 0, 0, 0.5)";
    expect(processDecl("color", value)).toBe(value);
  });

  it("complex rgba shadow passes through unchanged", () => {
    const value = "0 2px 4px rgba(0, 0, 0, 0.25)";
    expect(processDecl("box-shadow", value)).toBe(value);
  });
});

// ---------------------------------------------------------------------------
// CSS property variations
// ---------------------------------------------------------------------------

describe("postcss-hvv: works on any CSS property", () => {
  it("expands --hvv() in background-color", () => {
    const result = processDecl("background-color", "--hvv(blue, 5, 13)");
    expect(result).toBe("oklch(0.3115 0.0143 230)");
  });

  it("expands --hvv() in border-color", () => {
    const result = processDecl("border-color", "--hvv(green, 20, 40)");
    expect(result).toMatch(/^oklch\(/);
    expect(result).not.toContain("--hvv(");
  });

  it("expands --hvv() in fill (SVG property)", () => {
    const result = processDecl("fill", "--hvv(cherry, 50, 50)");
    expect(result).toMatch(/^oklch\(/);
    expect(result).not.toContain("--hvv(");
  });
});
