/**
 * Palette Engine tests — HVV Runtime.
 *
 * Tests cover:
 * - HUE_FAMILIES and MAX_CHROMA_FOR_HUE tables
 * - oklchToLinearSRGB, isInSRGBGamut, findMaxChroma, _deriveChromaCaps utilities
 * - hvvColor(): val→L piecewise, vib→C linear, optional peakChroma override
 * - DEFAULT_CANONICAL_L, L_DARK, L_LIGHT, PEAK_C_SCALE constants
 * - HVV_PRESETS: 7 entries with correct vib/val
 * - MAX_P3_CHROMA_FOR_HUE: all > corresponding sRGB caps
 * - oklchToLinearP3 and isInP3Gamut: P3 gamut conversion and checking
 * - injectHvvCSS(): Layer 1 presets (168), Layer 2 constants (74), P3 @media block
 * - Gamut safety: all 24 hues × 7 presets produce valid oklch strings
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { describe, it, expect, afterEach } from "bun:test";

import {
  HUE_FAMILIES,
  MAX_CHROMA_FOR_HUE,
  DEFAULT_LC_PARAMS,
  oklchToLinearSRGB,
  isInSRGBGamut,
  findMaxChroma,
  oklchToLinearP3,
  isInP3Gamut,
  _deriveChromaCaps,
  hvvColor,
  DEFAULT_CANONICAL_L,
  L_DARK,
  L_LIGHT,
  PEAK_C_SCALE,
  HVV_PRESETS,
  MAX_P3_CHROMA_FOR_HUE,
  injectHvvCSS,
} from "@/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an oklch() string into its numeric components. */
function parseOklch(s: string): { L: number; C: number; h: number } | null {
  const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!m) return null;
  return { L: parseFloat(m[1]), C: parseFloat(m[2]), h: parseFloat(m[3]) };
}

// ---------------------------------------------------------------------------
// HUE_FAMILIES
// ---------------------------------------------------------------------------

describe("HUE_FAMILIES", () => {
  it("has exactly 24 entries", () => {
    expect(Object.keys(HUE_FAMILIES).length).toBe(24);
  });

  it("contains expected hue names and angles", () => {
    expect(HUE_FAMILIES["cherry"]).toBe(10);
    expect(HUE_FAMILIES["red"]).toBe(25);
    expect(HUE_FAMILIES["yellow"]).toBe(90);
    expect(HUE_FAMILIES["blue"]).toBe(230);
    expect(HUE_FAMILIES["berry"]).toBe(355);
  });
});

// ---------------------------------------------------------------------------
// MAX_CHROMA_FOR_HUE (HVV L-range derivation)
// ---------------------------------------------------------------------------

describe("MAX_CHROMA_FOR_HUE", () => {
  it("has an entry for every hue family", () => {
    for (const name of Object.keys(HUE_FAMILIES)) {
      expect(MAX_CHROMA_FOR_HUE[name]).toBeDefined();
      expect(typeof MAX_CHROMA_FOR_HUE[name]).toBe("number");
    }
  });

  it("all caps are positive and at most cMax (0.22)", () => {
    for (const [name, cap] of Object.entries(MAX_CHROMA_FOR_HUE)) {
      expect(cap).toBeGreaterThan(0);
      expect(cap).toBeLessThanOrEqual(DEFAULT_LC_PARAMS.cMax + 0.001);
      void name;
    }
  });

  it("spot-check: red=0.220, green=0.220, yellow=0.125", () => {
    expect(MAX_CHROMA_FOR_HUE["red"]).toBe(0.220);
    expect(MAX_CHROMA_FOR_HUE["green"]).toBe(0.220);
    expect(MAX_CHROMA_FOR_HUE["yellow"]).toBe(0.125);
  });
});

// ---------------------------------------------------------------------------
// oklchToLinearSRGB and isInSRGBGamut (exported utilities)
// ---------------------------------------------------------------------------

describe("oklchToLinearSRGB()", () => {
  it("returns {r, g, b} object", () => {
    const result = oklchToLinearSRGB(0.5, 0, 0);
    expect(result).toHaveProperty("r");
    expect(result).toHaveProperty("g");
    expect(result).toHaveProperty("b");
  });

  it("achromatic (C=0) gives equal r, g, b channels", () => {
    const { r, g, b } = oklchToLinearSRGB(0.5, 0, 0);
    expect(r).toBeCloseTo(g, 5);
    expect(g).toBeCloseTo(b, 5);
  });
});

describe("isInSRGBGamut()", () => {
  it("returns true for a neutral gray", () => {
    expect(isInSRGBGamut(0.5, 0, 0)).toBe(true);
  });

  it("returns false for extreme chroma far outside sRGB", () => {
    expect(isInSRGBGamut(0.15, 0.5, 25)).toBe(false);
  });
});

describe("findMaxChroma()", () => {
  it("returns a positive value for a mid-range L and hue", () => {
    const cap = findMaxChroma(0.65, 25);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThan(0.4);
  });

  it("accepts an alternative gamut checker (P3 yields higher cap than sRGB)", () => {
    const srgbCap = findMaxChroma(0.65, 25);
    const p3Cap   = findMaxChroma(0.65, 25, 0.4, 32, isInP3Gamut);
    expect(p3Cap).toBeGreaterThan(srgbCap);
  });
});

describe("_deriveChromaCaps()", () => {
  it("returns a record with 24 entries when called with HVV L samples", () => {
    const hvvLSamples = (hue: string) => [L_DARK, DEFAULT_CANONICAL_L[hue] ?? 0.7, L_LIGHT];
    const caps = _deriveChromaCaps(hvvLSamples, isInSRGBGamut, DEFAULT_LC_PARAMS.cMax);
    expect(Object.keys(caps).length).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CANONICAL_L, L_DARK, L_LIGHT, PEAK_C_SCALE
// ---------------------------------------------------------------------------

describe("DEFAULT_CANONICAL_L", () => {
  it("has exactly 24 entries", () => {
    expect(Object.keys(DEFAULT_CANONICAL_L).length).toBe(24);
  });

  it("has entries for all 24 hue families", () => {
    for (const hue of Object.keys(HUE_FAMILIES)) {
      expect(DEFAULT_CANONICAL_L[hue]).toBeDefined();
    }
  });

  it("cherry=0.619, yellow=0.901", () => {
    expect(DEFAULT_CANONICAL_L["cherry"]).toBe(0.619);
    expect(DEFAULT_CANONICAL_L["yellow"]).toBe(0.901);
  });

  it("all canonical L values are above 0.555 (piecewise min() constraint)", () => {
    for (const [hue, l] of Object.entries(DEFAULT_CANONICAL_L)) {
      expect(l).toBeGreaterThan(0.555);
      void hue;
    }
  });
});

describe("L_DARK, L_LIGHT, PEAK_C_SCALE", () => {
  it("L_DARK is 0.15", () => { expect(L_DARK).toBe(0.15); });
  it("L_LIGHT is 0.96", () => { expect(L_LIGHT).toBe(0.96); });
  it("PEAK_C_SCALE is 2", () => { expect(PEAK_C_SCALE).toBe(2); });
});

// ---------------------------------------------------------------------------
// HVV_PRESETS
// ---------------------------------------------------------------------------

describe("HVV_PRESETS", () => {
  it("has exactly 7 entries", () => {
    expect(Object.keys(HVV_PRESETS).length).toBe(7);
  });

  it("canonical: vib=50, val=50", () => {
    expect(HVV_PRESETS["canonical"]).toEqual({ vib: 50, val: 50 });
  });
  it("accent: vib=80, val=50", () => {
    expect(HVV_PRESETS["accent"]).toEqual({ vib: 80, val: 50 });
  });
  it("muted: vib=25, val=55", () => {
    expect(HVV_PRESETS["muted"]).toEqual({ vib: 25, val: 55 });
  });
  it("light: vib=30, val=82", () => {
    expect(HVV_PRESETS["light"]).toEqual({ vib: 30, val: 82 });
  });
  it("subtle: vib=15, val=92", () => {
    expect(HVV_PRESETS["subtle"]).toEqual({ vib: 15, val: 92 });
  });
  it("dark: vib=50, val=25", () => {
    expect(HVV_PRESETS["dark"]).toEqual({ vib: 50, val: 25 });
  });
  it("deep: vib=70, val=15", () => {
    expect(HVV_PRESETS["deep"]).toEqual({ vib: 70, val: 15 });
  });
});

// ---------------------------------------------------------------------------
// hvvColor()
// ---------------------------------------------------------------------------

describe("hvvColor()", () => {
  it("returns a valid oklch() string", () => {
    expect(hvvColor("red", 50, 50, 0.659)).toMatch(/^oklch\(/);
  });

  it("val=50 produces canonical L", () => {
    const parsed = parseOklch(hvvColor("red", 50, 50, 0.659));
    expect(parsed!.L).toBeCloseTo(0.659, 3);
  });

  it("vib=0 produces C=0 (achromatic)", () => {
    const parsed = parseOklch(hvvColor("red", 0, 50, 0.659));
    expect(parsed!.C).toBe(0);
  });

  it("val=0 produces L=L_DARK (0.15)", () => {
    const parsed = parseOklch(hvvColor("red", 50, 0, 0.659));
    expect(parsed!.L).toBeCloseTo(L_DARK, 3);
  });

  it("val=100 produces L=L_LIGHT (0.96)", () => {
    const parsed = parseOklch(hvvColor("red", 50, 100, 0.659));
    expect(parsed!.L).toBeCloseTo(L_LIGHT, 3);
  });

  it("vib=100 with no peakChroma gives C = MAX_CHROMA_FOR_HUE['red'] * PEAK_C_SCALE", () => {
    const parsed = parseOklch(hvvColor("red", 100, 50, 0.659));
    expect(parsed!.C).toBeCloseTo(MAX_CHROMA_FOR_HUE["red"] * PEAK_C_SCALE, 4);
  });

  it("explicit peakChroma=0.5 overrides default", () => {
    const parsed = parseOklch(hvvColor("red", 100, 50, 0.659, 0.5));
    expect(parsed!.C).toBeCloseTo(0.5, 4);
  });

  it("no peakChroma matches explicit default peakChroma", () => {
    const defaultPeak = MAX_CHROMA_FOR_HUE["red"] * PEAK_C_SCALE;
    expect(hvvColor("red", 50, 50, 0.659)).toBe(hvvColor("red", 50, 50, 0.659, defaultPeak));
  });

  it("all 24 hue names produce valid oklch strings at canonical (50/50)", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const result = hvvColor(hueName, 50, 50, DEFAULT_CANONICAL_L[hueName]);
      expect(result).toMatch(/^oklch\(/);
      expect(parseOklch(result)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// MAX_P3_CHROMA_FOR_HUE
// ---------------------------------------------------------------------------

describe("MAX_P3_CHROMA_FOR_HUE", () => {
  it("has exactly 24 entries", () => {
    expect(Object.keys(MAX_P3_CHROMA_FOR_HUE).length).toBe(24);
  });

  it("all P3 caps are strictly greater than corresponding sRGB caps", () => {
    const violations: string[] = [];
    for (const name of Object.keys(HUE_FAMILIES)) {
      const p3   = MAX_P3_CHROMA_FOR_HUE[name];
      const srgb = MAX_CHROMA_FOR_HUE[name];
      if (p3 === undefined || srgb === undefined || p3 <= srgb) {
        violations.push(`${name}: P3=${p3} sRGB=${srgb}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("spot-check: red P3=0.282 > sRGB=0.220", () => {
    expect(MAX_P3_CHROMA_FOR_HUE["red"]).toBe(0.282);
    expect(MAX_P3_CHROMA_FOR_HUE["red"]).toBeGreaterThan(MAX_CHROMA_FOR_HUE["red"]);
  });

  it("spot-check: green P3=0.305 > sRGB=0.220", () => {
    expect(MAX_P3_CHROMA_FOR_HUE["green"]).toBe(0.305);
    expect(MAX_P3_CHROMA_FOR_HUE["green"]).toBeGreaterThan(MAX_CHROMA_FOR_HUE["green"]);
  });
});

// ---------------------------------------------------------------------------
// oklchToLinearP3() and isInP3Gamut()
// ---------------------------------------------------------------------------

describe("oklchToLinearP3()", () => {
  it("returns an {r, g, b} object", () => {
    const result = oklchToLinearP3(0.5, 0, 0);
    expect(result).toHaveProperty("r");
    expect(result).toHaveProperty("g");
    expect(result).toHaveProperty("b");
  });

  it("pure black (L=0, C=0) maps to {r≈0, g≈0, b≈0}", () => {
    const { r, g, b } = oklchToLinearP3(0, 0, 0);
    expect(r).toBeCloseTo(0, 3);
    expect(g).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(0, 3);
  });

  it("near-white (L=1, C=0) maps to channels near 1 (precision 2 for matrix rounding)", () => {
    const { r, g, b } = oklchToLinearP3(1, 0, 0);
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(1, 2);
    expect(b).toBeCloseTo(1, 2);
  });

  it("P3 channels differ from sRGB channels for a saturated color", () => {
    const L = 0.7, C = 0.15, h = 145;
    const srgb = oklchToLinearSRGB(L, C, h);
    const p3   = oklchToLinearP3(L, C, h);
    expect(p3.r).not.toBeCloseTo(srgb.r, 6);
  });
});

describe("isInP3Gamut()", () => {
  it("returns true for a neutral gray", () => {
    expect(isInP3Gamut(0.5, 0, 0)).toBe(true);
  });

  it("returns true for a color inside P3 but outside sRGB", () => {
    // C=0.24 at L=0.7, h=140: outside sRGB but inside P3
    expect(isInP3Gamut(0.7, 0.24, 140)).toBe(true);
    expect(isInSRGBGamut(0.7, 0.24, 140)).toBe(false);
  });

  it("returns false for extreme chroma outside P3", () => {
    expect(isInP3Gamut(0.15, 0.5, 25)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// injectHvvCSS() — Layer 1 presets and Layer 2 constants
// ---------------------------------------------------------------------------

describe("injectHvvCSS() — Layer 1 and Layer 2", () => {
  afterEach(() => {
    const el = document.getElementById("tug-palette");
    if (el) el.remove();
  });

  it("creates a <style id='tug-palette'> element in document.head", () => {
    injectHvvCSS("brio");
    const el = document.getElementById("tug-palette");
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe("style");
  });

  it("CSS contains --tug-red: with an oklch value (canonical preset)", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    expect(css).toContain("--tug-red:");
    expect(css).toContain("oklch(");
  });

  it("CSS contains --tug-red-accent: with an oklch value", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    expect(css).toMatch(/--tug-red-accent:\s*oklch\(/);
  });

  it("CSS contains all 7 preset variables for red", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    expect(css).toContain("--tug-red:");
    expect(css).toContain("--tug-red-accent:");
    expect(css).toContain("--tug-red-muted:");
    expect(css).toContain("--tug-red-light:");
    expect(css).toContain("--tug-red-subtle:");
    expect(css).toContain("--tug-red-dark:");
    expect(css).toContain("--tug-red-deep:");
  });

  it("total preset variable count is 168 in the sRGB block (7 x 24)", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    const srgbBlock = css.slice(0, css.indexOf("@media (color-gamut: p3)"));
    const presets = srgbBlock.match(/--tug-\w+(?:-(?:accent|muted|light|subtle|dark|deep))?:\s*oklch\(/g) ?? [];
    expect(presets.length).toBe(168);
  });

  it("CSS contains --tug-red-h: 25 (per-hue hue angle constant)", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    expect(css).toContain("--tug-red-h: 25;");
  });

  it("CSS contains --tug-red-canon-l: matching DEFAULT_CANONICAL_L['red']", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    expect(css).toContain(`--tug-red-canon-l: ${DEFAULT_CANONICAL_L["red"]};`);
  });

  it("CSS contains --tug-red-peak-c: matching MAX_CHROMA_FOR_HUE['red'] * PEAK_C_SCALE", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    const expectedPeakC = parseFloat((MAX_CHROMA_FOR_HUE["red"] * PEAK_C_SCALE).toFixed(4));
    expect(css).toContain(`--tug-red-peak-c: ${expectedPeakC};`);
  });

  it("CSS contains --tug-l-dark: 0.15 and --tug-l-light: 0.96", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    expect(css).toContain(`--tug-l-dark: ${L_DARK};`);
    expect(css).toContain(`--tug-l-light: ${L_LIGHT};`);
  });

  it("total constant count is 74 in the sRGB block (72 per-hue + 2 global)", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    const srgbBlock = css.slice(0, css.indexOf("@media (color-gamut: p3)"));
    const perHueH      = srgbBlock.match(/--tug-\w+-h:\s*\d+;/g) ?? [];
    const perHueCanonL = srgbBlock.match(/--tug-\w+-canon-l:\s*[\d.]+;/g) ?? [];
    const perHuePeakC  = srgbBlock.match(/--tug-\w+-peak-c:\s*[\d.]+;/g) ?? [];
    const globals      = srgbBlock.match(/--tug-l-(?:dark|light):\s*[\d.]+;/g) ?? [];
    expect(perHueH.length).toBe(24);
    expect(perHueCanonL.length).toBe(24);
    expect(perHuePeakC.length).toBe(24);
    expect(globals.length).toBe(2);
    expect(perHueH.length + perHueCanonL.length + perHuePeakC.length + globals.length).toBe(74);
  });

  it("idempotent — calling twice creates only one style element", () => {
    injectHvvCSS("brio");
    injectHvvCSS("brio");
    expect(document.querySelectorAll("#tug-palette").length).toBe(1);
  });

  it("preset value for red canonical matches direct hvvColor call", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    const match = css.match(/--tug-red:\s*(oklch\([^;]+\));/);
    expect(match).not.toBeNull();
    const expected = hvvColor("red", HVV_PRESETS["canonical"].vib, HVV_PRESETS["canonical"].val, DEFAULT_CANONICAL_L["red"]);
    expect(match![1]).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// injectHvvCSS() — P3 @media block
// ---------------------------------------------------------------------------

describe("injectHvvCSS() — P3 @media block", () => {
  afterEach(() => {
    const el = document.getElementById("tug-palette");
    if (el) el.remove();
  });

  it("output contains '@media (color-gamut: p3)'", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    expect(css).toContain("@media (color-gamut: p3)");
  });

  it("P3 block contains --tug-red: with wider chroma than the sRGB block", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    const mediaIdx = css.indexOf("@media (color-gamut: p3)");
    const srgbBlock = css.slice(0, mediaIdx);
    const p3Block   = css.slice(mediaIdx);
    const srgbMatch = srgbBlock.match(/--tug-red:\s*oklch\([\d.]+ ([\d.]+) \d+\);/);
    const p3Match   = p3Block.match(/--tug-red:\s*oklch\([\d.]+ ([\d.]+) \d+\);/);
    expect(srgbMatch).not.toBeNull();
    expect(p3Match).not.toBeNull();
    expect(parseFloat(p3Match![1])).toBeGreaterThan(parseFloat(srgbMatch![1]));
  });

  it("P3 --tug-red-peak-c: is greater than sRGB --tug-red-peak-c:", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    const mediaIdx  = css.indexOf("@media (color-gamut: p3)");
    const srgbBlock = css.slice(0, mediaIdx);
    const p3Block   = css.slice(mediaIdx);
    const srgbPeak = parseFloat(srgbBlock.match(/--tug-red-peak-c:\s*([\d.]+);/)![1]);
    const p3Peak   = parseFloat(p3Block.match(/--tug-red-peak-c:\s*([\d.]+);/)![1]);
    expect(p3Peak).toBeGreaterThan(srgbPeak);
  });

  it("P3 peak-c for red equals MAX_P3_CHROMA_FOR_HUE['red'] * PEAK_C_SCALE", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    const p3Block = css.slice(css.indexOf("@media (color-gamut: p3)"));
    const match = p3Block.match(/--tug-red-peak-c:\s*([\d.]+);/);
    expect(match).not.toBeNull();
    const expected = parseFloat((MAX_P3_CHROMA_FOR_HUE["red"] * PEAK_C_SCALE).toFixed(4));
    expect(parseFloat(match![1])).toBeCloseTo(expected, 4);
  });
});

// ---------------------------------------------------------------------------
// Gamut safety: all 24 hues x 7 presets
// ---------------------------------------------------------------------------

describe("Gamut safety: all 24 hues x 7 presets", () => {
  it("all 168 sRGB presets produce parseable oklch strings", () => {
    let count = 0;
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      for (const { vib, val } of Object.values(HVV_PRESETS)) {
        const result = hvvColor(hueName, vib, val, canonL);
        expect(result).toMatch(/^oklch\(/);
        expect(parseOklch(result)).not.toBeNull();
        count++;
      }
    }
    expect(count).toBe(168);
  });

  it("all 168 P3 presets produce parseable oklch strings", () => {
    let count = 0;
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL  = DEFAULT_CANONICAL_L[hueName];
      const p3PeakC = MAX_P3_CHROMA_FOR_HUE[hueName] * PEAK_C_SCALE;
      for (const { vib, val } of Object.values(HVV_PRESETS)) {
        const result = hvvColor(hueName, vib, val, canonL, p3PeakC);
        expect(result).toMatch(/^oklch\(/);
        expect(parseOklch(result)).not.toBeNull();
        count++;
      }
    }
    expect(count).toBe(168);
  });

  it("injectHvvCSS output contains oklch values for all 168 sRGB presets", () => {
    injectHvvCSS("brio");
    const css = document.getElementById("tug-palette")!.textContent ?? "";
    const srgbBlock = css.slice(0, css.indexOf("@media (color-gamut: p3)"));
    const presets = srgbBlock.match(/:\s*oklch\([^;]+\);/g) ?? [];
    expect(presets.length).toBe(168);
    document.getElementById("tug-palette")?.remove();
  });
});
