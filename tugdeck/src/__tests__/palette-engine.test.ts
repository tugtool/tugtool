/**
 * Palette Engine tests — HVV Runtime + tug-palette.css verification.
 *
 * Tests cover:
 * - HUE_FAMILIES and MAX_CHROMA_FOR_HUE tables
 * - oklchToLinearSRGB, isInSRGBGamut, findMaxChroma, _deriveChromaCaps utilities
 * - hvvColor(): val→L piecewise, vib→C linear, optional peakChroma override
 * - DEFAULT_CANONICAL_L, L_DARK, L_LIGHT, PEAK_C_SCALE constants
 * - HVV_PRESETS: 5 entries with correct vib/val
 * - MAX_P3_CHROMA_FOR_HUE: all > corresponding sRGB caps
 * - oklchToLinearP3 and isInP3Gamut: P3 gamut conversion and checking
 * - Gamut safety: all 24 hues × 5 presets produce valid oklch strings
 * - tug-palette.css: verifies static palette file structure and contents
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "bun:test";

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
  oklchToHVV,
  hvvPretty,
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
  it("has exactly 5 entries", () => {
    expect(Object.keys(HVV_PRESETS).length).toBe(5);
  });

  it("contains exactly the keys: canonical, light, dark, intense, muted", () => {
    expect(Object.keys(HVV_PRESETS).sort()).toEqual(["canonical", "dark", "intense", "light", "muted"]);
  });

  it("canonical: vib=50, val=50", () => {
    expect(HVV_PRESETS["canonical"]).toEqual({ vib: 50, val: 50 });
  });
  it("light: vib=20, val=85", () => {
    expect(HVV_PRESETS["light"]).toEqual({ vib: 20, val: 85 });
  });
  it("dark: vib=50, val=20", () => {
    expect(HVV_PRESETS["dark"]).toEqual({ vib: 50, val: 20 });
  });
  it("intense: vib=90, val=50", () => {
    expect(HVV_PRESETS["intense"]).toEqual({ vib: 90, val: 50 });
  });
  it("muted: vib=20, val=50", () => {
    expect(HVV_PRESETS["muted"]).toEqual({ vib: 20, val: 50 });
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
// tug-palette.css — static palette file verification
// ---------------------------------------------------------------------------

// Resolve the CSS file relative to the tugdeck root
const TUG_PALETTE_CSS = readFileSync(
  join(import.meta.dir, "../../styles/tug-palette.css"),
  "utf8"
);

describe("tug-palette.css — per-hue constants", () => {
  it("contains all 24 --tug-{hue}-h variables", () => {
    for (const hue of Object.keys(HUE_FAMILIES)) {
      expect(TUG_PALETTE_CSS).toContain(`--tug-${hue}-h:`);
    }
  });

  it("all 24 --tug-{hue}-h values match HUE_FAMILIES angles", () => {
    for (const [hue, angle] of Object.entries(HUE_FAMILIES)) {
      const pattern = new RegExp(`--tug-${hue}-h:\\s*${angle};`);
      expect(TUG_PALETTE_CSS).toMatch(pattern);
    }
  });

  it("contains all 24 --tug-{hue}-canonical-l variables", () => {
    for (const hue of Object.keys(HUE_FAMILIES)) {
      expect(TUG_PALETTE_CSS).toContain(`--tug-${hue}-canonical-l:`);
    }
  });

  it("contains all 24 --tug-{hue}-peak-c variables", () => {
    for (const hue of Object.keys(HUE_FAMILIES)) {
      expect(TUG_PALETTE_CSS).toContain(`--tug-${hue}-peak-c:`);
    }
  });

  it("total per-hue constant count is 72 (24 hues × 3 constants)", () => {
    const hVars     = (TUG_PALETTE_CSS.match(/--tug-\w+-h:\s*\d+;/g) ?? []).filter(v => !v.includes("peak"));
    const canonLVars = TUG_PALETTE_CSS.match(/--tug-\w+-canonical-l:\s*[\d.]+;/g) ?? [];
    const peakCVars  = TUG_PALETTE_CSS.match(/--tug-\w+-peak-c:\s*[\d.]+;/g) ?? [];
    // Only count the sRGB block (before @media)
    const srgbBlock = TUG_PALETTE_CSS.slice(0, TUG_PALETTE_CSS.indexOf("@media (color-gamut: p3)"));
    const srgbH      = (srgbBlock.match(/--tug-\w+-h:\s*\d+;/g) ?? []).filter(v => !v.includes("peak"));
    const srgbCanonL = srgbBlock.match(/--tug-\w+-canonical-l:\s*[\d.]+;/g) ?? [];
    const srgbPeakC  = srgbBlock.match(/--tug-\w+-peak-c:\s*[\d.]+;/g) ?? [];
    expect(srgbH.length).toBe(24);
    expect(srgbCanonL.length).toBe(24);
    expect(srgbPeakC.length).toBe(24);
    void hVars; void canonLVars; void peakCVars;
  });
});

describe("tug-palette.css — global lightness anchors", () => {
  it("contains --tug-l-dark: 0.15", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-l-dark: 0.15;");
  });

  it("contains --tug-l-light: 0.96", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-l-light: 0.96;");
  });
});

describe("tug-palette.css — chromatic preset formulas (120 = 24 × 5)", () => {
  it("contains all 5 preset variables for red", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-red:");
    expect(TUG_PALETTE_CSS).toContain("--tug-red-light:");
    expect(TUG_PALETTE_CSS).toContain("--tug-red-dark:");
    expect(TUG_PALETTE_CSS).toContain("--tug-red-intense:");
    expect(TUG_PALETTE_CSS).toContain("--tug-red-muted:");
  });

  it("does NOT contain removed preset variables for red", () => {
    expect(TUG_PALETTE_CSS).not.toContain("--tug-red-accent:");
    expect(TUG_PALETTE_CSS).not.toContain("--tug-red-subtle:");
    expect(TUG_PALETTE_CSS).not.toContain("--tug-red-deep:");
  });

  it("contains all 5 preset variables for all 24 hues", () => {
    const presetSuffixes = ["", "-light", "-dark", "-intense", "-muted"];
    for (const hue of Object.keys(HUE_FAMILIES)) {
      for (const suffix of presetSuffixes) {
        expect(TUG_PALETTE_CSS).toContain(`--tug-${hue}${suffix}:`);
      }
    }
  });

  it("total chromatic preset variable count is 120 in the sRGB block (5 × 24)", () => {
    const srgbBlock = TUG_PALETTE_CSS.slice(0, TUG_PALETTE_CSS.indexOf("@media (color-gamut: p3)"));
    const hueNames = Object.keys(HUE_FAMILIES).join("|");
    // Only count chromatic hue presets, not neutral/black/white
    const chromaticPattern = new RegExp(`--tug-(?:${hueNames})(?:-(?:intense|muted|light|dark))?:\\s*oklch\\(`, "g");
    const presets = srgbBlock.match(chromaticPattern) ?? [];
    expect(presets.length).toBe(120);
  });

  it("preset formulas use oklch( and calc( patterns", () => {
    expect(TUG_PALETTE_CSS).toContain("oklch(");
    expect(TUG_PALETTE_CSS).toContain("calc(");
  });

  it("preset formulas reference var(--tug-{hue}-canonical-l) and var(--tug-{hue}-peak-c)", () => {
    expect(TUG_PALETTE_CSS).toContain("var(--tug-red-canonical-l)");
    expect(TUG_PALETTE_CSS).toContain("var(--tug-red-peak-c)");
  });

  it("preset formulas use clamp() for val-to-L piecewise mapping", () => {
    expect(TUG_PALETTE_CSS).toContain("clamp(");
  });

  it("does NOT contain coefficient knob variables (--tug-preset-*)", () => {
    expect(TUG_PALETTE_CSS).not.toMatch(/--tug-preset-/);
  });
});

describe("tug-palette.css — neutral ramp and anchors", () => {
  it("contains --tug-neutral (canonical)", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-neutral:");
  });

  it("contains --tug-neutral-light", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-neutral-light:");
  });

  it("contains --tug-neutral-dark", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-neutral-dark:");
  });

  it("contains --tug-neutral-intense", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-neutral-intense:");
  });

  it("contains --tug-neutral-muted", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-neutral-muted:");
  });

  it("does NOT contain removed neutral presets (accent, subtle, deep)", () => {
    expect(TUG_PALETTE_CSS).not.toContain("--tug-neutral-accent:");
    expect(TUG_PALETTE_CSS).not.toContain("--tug-neutral-subtle:");
    expect(TUG_PALETTE_CSS).not.toContain("--tug-neutral-deep:");
  });

  it("neutral ramp has exactly 5 preset definitions", () => {
    const neutralPresets = TUG_PALETTE_CSS.match(/--tug-neutral(?:-\w+)?:\s*oklch\([^;]+\);/g) ?? [];
    expect(neutralPresets.length).toBe(5);
  });

  it("contains --tug-black", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-black:");
  });

  it("contains --tug-white", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-white:");
  });

  it("--tug-black is oklch(0 0 0)", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-black: oklch(0 0 0)");
  });

  it("--tug-white is oklch(1 0 0)", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-white: oklch(1 0 0)");
  });

  it("all neutral variables use C=0 (achromatic)", () => {
    const neutralLines = TUG_PALETTE_CSS.match(/--tug-neutral[^:]*:\s*oklch\([^;]+\);/g) ?? [];
    expect(neutralLines.length).toBeGreaterThan(0);
    for (const line of neutralLines) {
      // oklch(L 0 0) pattern — C must be 0
      expect(line).toMatch(/oklch\([\d.]+ 0 0\)/);
    }
  });
});

describe("tug-palette.css — no P3 @media block", () => {
  it("does not contain @media (color-gamut: p3) block", () => {
    expect(TUG_PALETTE_CSS).not.toContain("@media (color-gamut: p3)");
  });
});

// ---------------------------------------------------------------------------
// Gamut safety: all 24 hues x 7 presets
// ---------------------------------------------------------------------------

describe("Gamut safety: all 24 hues x 5 presets", () => {
  it("all 120 sRGB presets produce parseable oklch strings", () => {
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
    expect(count).toBe(120);
  });

  it("all 120 P3 presets produce parseable oklch strings", () => {
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
    expect(count).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// oklchToHVV() and hvvPretty()
// ---------------------------------------------------------------------------

describe("oklchToHVV()", () => {
  it("round-trip: all 24 hues at vib=50, val=50 recover exact hue name and vib/val", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const oklch = hvvColor(hueName, 50, 50, canonL);
      const result = oklchToHVV(oklch);
      expect(result.hue).toBe(hueName);
      expect(result.vib).toBe(50);
      expect(result.val).toBe(50);
    }
  });

  it("round-trip edge values: vib=0, vib=100, val=0, val=100", () => {
    const hueName = "blue";
    const canonL = DEFAULT_CANONICAL_L[hueName];

    const r0 = oklchToHVV(hvvColor(hueName, 0, 50, canonL));
    expect(r0.hue).toBe(hueName);
    expect(r0.vib).toBe(0);
    expect(r0.val).toBe(50);

    const r100 = oklchToHVV(hvvColor(hueName, 100, 50, canonL));
    expect(r100.hue).toBe(hueName);
    expect(r100.vib).toBe(100);
    expect(r100.val).toBe(50);

    const rV0 = oklchToHVV(hvvColor(hueName, 50, 0, canonL));
    expect(rV0.hue).toBe(hueName);
    expect(rV0.vib).toBe(50);
    expect(rV0.val).toBe(0);

    const rV100 = oklchToHVV(hvvColor(hueName, 50, 100, canonL));
    expect(rV100.hue).toBe(hueName);
    expect(rV100.vib).toBe(50);
    expect(rV100.val).toBe(100);
  });

  it("raw angle test: oklch at hue angle 237 (not close to any named hue) returns hue-237", () => {
    // hue angle 237 — blue=230(7deg away), cobalt=250(13deg away), both > 5 deg threshold
    // Wait: 237-230=7, 250-237=13 — 7 > 5, so raw angle
    const oklch = "oklch(0.5 0.05 237)";
    const result = oklchToHVV(oklch);
    expect(result.hue).toBe("hue-237");
  });

  it("round-trip: all 24 hues at vib=20, val=85 recover correct hue name", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const oklch = hvvColor(hueName, 20, 85, canonL);
      const result = oklchToHVV(oklch);
      expect(result.hue).toBe(hueName);
      expect(result.vib).toBe(20);
      expect(result.val).toBe(85);
    }
  });

  it("returns hue-NNN for raw angle when not within 5 degrees of any named hue", () => {
    // angle 237 is 7 degrees from blue (230), just outside the 5-degree threshold
    const result = oklchToHVV("oklch(0.7 0.08 237)");
    expect(result.hue).toMatch(/^hue-\d+/);
  });

  it("returns a named hue when within 5 degrees of a named hue angle", () => {
    // blue is at 230; angle 234 is 4 degrees away — within threshold
    const result = oklchToHVV("oklch(0.7 0.08 234)");
    expect(result.hue).toBe("blue");
  });

  it("returns valid {hue, vib, val} for an invalid oklch string", () => {
    const result = oklchToHVV("not-oklch");
    expect(result).toHaveProperty("hue");
    expect(result).toHaveProperty("vib");
    expect(result).toHaveProperty("val");
  });
});

describe("hvvPretty()", () => {
  it("formats named hue as 'blue vib=5 val=13'", () => {
    // blue at angle 230, within 5 deg threshold
    const oklch = hvvColor("blue", 5, 13, DEFAULT_CANONICAL_L["blue"]);
    const result = hvvPretty(oklch);
    expect(result).toMatch(/^blue vib=\d+ val=\d+/);
    expect(result).toBe("blue vib=5 val=13");
  });

  it("formats raw angle as 'hue-NNN vib=N val=N'", () => {
    const result = hvvPretty("oklch(0.5 0.05 237)");
    expect(result).toMatch(/^hue-237 vib=\d+ val=\d+$/);
  });

  it("round-trip: hvvPretty(hvvColor(hue, vib, val)) contains correct hue name", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const oklch = hvvColor(hueName, 50, 50, canonL);
      const pretty = hvvPretty(oklch);
      expect(pretty).toMatch(new RegExp(`^${hueName} `));
    }
  });
});
