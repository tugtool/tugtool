/**
 * Palette Engine tests — TugColor Runtime + tug-palette.css verification.
 *
 * Tests cover:
 * - HUE_FAMILIES (48 entries) and MAX_CHROMA_FOR_HUE tables
 * - ADJACENCY_RING, resolveHyphenatedHue, isAdjacent
 * - oklchToLinearSRGB, isInSRGBGamut, findMaxChroma, _deriveChromaCaps utilities
 * - tugColor(): tone→L piecewise, intensity→C linear, optional peakChroma override
 * - DEFAULT_CANONICAL_L, L_DARK, L_LIGHT, PEAK_C_SCALE constants
 * - TUG_COLOR_PRESETS: 5 entries with correct intensity/tone
 * - MAX_P3_CHROMA_FOR_HUE: all > corresponding sRGB caps
 * - oklchToLinearP3 and isInP3Gamut: P3 gamut conversion and checking
 * - Gamut safety: all 48 hues × 5 presets produce valid oklch strings
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
  ADJACENCY_RING,
  resolveHyphenatedHue,
  isAdjacent,
  MAX_CHROMA_FOR_HUE,
  DEFAULT_LC_PARAMS,
  oklchToLinearSRGB,
  isInSRGBGamut,
  findMaxChroma,
  oklchToLinearP3,
  isInP3Gamut,
  _deriveChromaCaps,
  tugColor,
  DEFAULT_CANONICAL_L,
  L_DARK,
  L_LIGHT,
  PEAK_C_SCALE,
  TUG_COLOR_PRESETS,
  MAX_P3_CHROMA_FOR_HUE,
  oklchToTugColor,
  tugColorPretty,
  NAMED_GRAYS,
  ACHROMATIC_SEQUENCE,
  ACHROMATIC_L_VALUES,
  resolveAchromaticAdjacency,
  isAchromaticAdjacent,
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
  it("has exactly 48 entries", () => {
    expect(Object.keys(HUE_FAMILIES).length).toBe(48);
  });

  it("contains expected original hue names and angles", () => {
    expect(HUE_FAMILIES["cherry"]).toBe(10);
    expect(HUE_FAMILIES["red"]).toBe(25);
    expect(HUE_FAMILIES["yellow"]).toBe(90);
    expect(HUE_FAMILIES["blue"]).toBe(230);
    expect(HUE_FAMILIES["berry"]).toBe(355);
  });

  it("contains expected new hue names and angles", () => {
    expect(HUE_FAMILIES["garnet"]).toBe(2.5);
    expect(HUE_FAMILIES["scarlet"]).toBe(15);
    expect(HUE_FAMILIES["indigo"]).toBe(260);
    expect(HUE_FAMILIES["iris"]).toBe(277.5);
    expect(HUE_FAMILIES["fuchsia"]).toBe(350);
  });
});

// ---------------------------------------------------------------------------
// ADJACENCY_RING, resolveHyphenatedHue, isAdjacent
// ---------------------------------------------------------------------------

describe("ADJACENCY_RING", () => {
  it("has exactly 48 entries matching HUE_FAMILIES keys", () => {
    expect(ADJACENCY_RING.length).toBe(48);
    expect(ADJACENCY_RING.length).toBe(Object.keys(HUE_FAMILIES).length);
  });

  it("contains every hue name from HUE_FAMILIES exactly once", () => {
    const ringSet = new Set(ADJACENCY_RING);
    for (const hue of Object.keys(HUE_FAMILIES)) {
      expect(ringSet.has(hue)).toBe(true);
    }
  });

  it("is in strictly ascending hue-angle order", () => {
    for (let i = 0; i < ADJACENCY_RING.length - 1; i++) {
      const a = HUE_FAMILIES[ADJACENCY_RING[i]];
      const b = HUE_FAMILIES[ADJACENCY_RING[i + 1]];
      expect(a).toBeLessThan(b);
    }
  });

  it("starts with garnet (2.5) and ends with berry (355)", () => {
    expect(ADJACENCY_RING[0]).toBe("garnet");
    expect(ADJACENCY_RING[ADJACENCY_RING.length - 1]).toBe("berry");
  });
});

describe("resolveHyphenatedHue()", () => {
  it("yellow-chartreuse resolves to approximately 94.2 degrees (2/3*90 + 1/3*102.5)", () => {
    const result = resolveHyphenatedHue("yellow", "chartreuse");
    expect(result).toBeCloseTo(94.17, 1);
  });

  it("berry-garnet wraps correctly across 360/0 boundary (approximately 357.5)", () => {
    const result = resolveHyphenatedHue("berry", "garnet");
    // 2/3*355 + 1/3*2.5 (wrap: 2.5+360=362.5) = 236.67 + 120.83 = 357.5
    expect(result).toBeCloseTo(357.5, 1);
  });

  it("cobalt-indigo resolves to approximately 253.3 degrees (2/3*250 + 1/3*260)", () => {
    const result = resolveHyphenatedHue("cobalt", "indigo");
    expect(result).toBeCloseTo(253.33, 1);
  });

  it("indigo-cobalt resolves to approximately 256.7 degrees (2/3*260 + 1/3*250)", () => {
    const result = resolveHyphenatedHue("indigo", "cobalt");
    expect(result).toBeCloseTo(256.67, 1);
  });

  it("throws for unknown hue names", () => {
    expect(() => resolveHyphenatedHue("notahue", "blue")).toThrow();
  });
});

describe("isAdjacent()", () => {
  it("yellow and chartreuse are adjacent", () => {
    expect(isAdjacent("yellow", "chartreuse")).toBe(true);
  });

  it("chartreuse and yellow are adjacent (symmetric)", () => {
    expect(isAdjacent("chartreuse", "yellow")).toBe(true);
  });

  it("yellow and blue are not adjacent", () => {
    expect(isAdjacent("yellow", "blue")).toBe(false);
  });

  it("berry and garnet are adjacent (wrap around)", () => {
    expect(isAdjacent("berry", "garnet")).toBe(true);
  });

  it("garnet and berry are adjacent (wrap around, symmetric)", () => {
    expect(isAdjacent("garnet", "berry")).toBe(true);
  });

  it("unknown hue returns false", () => {
    expect(isAdjacent("notahue", "blue")).toBe(false);
  });

  it("all MAX_CHROMA_FOR_HUE new-24 entries are positive and at most cMax", () => {
    const newHues = ["garnet", "scarlet", "crimson", "vermilion", "ember", "tangerine",
      "apricot", "honey", "saffron", "chartreuse", "grass", "jade", "seafoam", "aqua",
      "azure", "cerulean", "sapphire", "indigo", "iris", "grape", "orchid", "peony",
      "cerise", "fuchsia"];
    for (const hue of newHues) {
      const cap = MAX_CHROMA_FOR_HUE[hue];
      expect(cap).toBeDefined();
      expect(cap).toBeGreaterThan(0);
      expect(cap).toBeLessThanOrEqual(DEFAULT_LC_PARAMS.cMax + 0.001);
    }
  });
});

// ---------------------------------------------------------------------------
// MAX_CHROMA_FOR_HUE (TugColor L-range derivation)
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
  it("returns a record with 48 entries when called with TugColor L samples", () => {
    const tugColorLSamples = (hue: string) => [L_DARK, DEFAULT_CANONICAL_L[hue] ?? 0.7, L_LIGHT];
    const caps = _deriveChromaCaps(tugColorLSamples, isInSRGBGamut, DEFAULT_LC_PARAMS.cMax);
    expect(Object.keys(caps).length).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CANONICAL_L, L_DARK, L_LIGHT, PEAK_C_SCALE
// ---------------------------------------------------------------------------

describe("DEFAULT_CANONICAL_L", () => {
  it("has exactly 48 entries", () => {
    expect(Object.keys(DEFAULT_CANONICAL_L).length).toBe(48);
  });

  it("has entries for all 48 hue families", () => {
    for (const hue of Object.keys(HUE_FAMILIES)) {
      expect(DEFAULT_CANONICAL_L[hue]).toBeDefined();
    }
  });

  it("cherry=0.619, yellow=0.901", () => {
    expect(DEFAULT_CANONICAL_L["cherry"]).toBe(0.619);
    expect(DEFAULT_CANONICAL_L["yellow"]).toBe(0.901);
  });

  it("new hues have correct canonical L values (interpolated from original 24)", () => {
    expect(DEFAULT_CANONICAL_L["garnet"]).toBe(0.643);
    expect(DEFAULT_CANONICAL_L["indigo"]).toBe(0.726);
    expect(DEFAULT_CANONICAL_L["chartreuse"]).toBe(0.881);
  });

  it("all canonical L values are at or above 0.555 (piecewise min() constraint)", () => {
    for (const [hue, l] of Object.entries(DEFAULT_CANONICAL_L)) {
      expect(l).toBeGreaterThanOrEqual(0.555);
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
// TUG_COLOR_PRESETS
// ---------------------------------------------------------------------------

describe("TUG_COLOR_PRESETS", () => {
  it("has exactly 5 entries", () => {
    expect(Object.keys(TUG_COLOR_PRESETS).length).toBe(5);
  });

  it("contains exactly the keys: canonical, light, dark, intense, muted", () => {
    expect(Object.keys(TUG_COLOR_PRESETS).sort()).toEqual(["canonical", "dark", "intense", "light", "muted"]);
  });

  it("canonical: intensity=50, tone=50", () => {
    expect(TUG_COLOR_PRESETS["canonical"]).toEqual({ intensity: 50, tone: 50 });
  });
  it("light: intensity=20, tone=85", () => {
    expect(TUG_COLOR_PRESETS["light"]).toEqual({ intensity: 20, tone: 85 });
  });
  it("dark: intensity=50, tone=20", () => {
    expect(TUG_COLOR_PRESETS["dark"]).toEqual({ intensity: 50, tone: 20 });
  });
  it("intense: intensity=90, tone=50", () => {
    expect(TUG_COLOR_PRESETS["intense"]).toEqual({ intensity: 90, tone: 50 });
  });
  it("muted: intensity=50, tone=42", () => {
    expect(TUG_COLOR_PRESETS["muted"]).toEqual({ intensity: 50, tone: 42 });
  });
});

// ---------------------------------------------------------------------------
// tugColor()
// ---------------------------------------------------------------------------

describe("tugColor()", () => {
  it("returns a valid oklch() string", () => {
    expect(tugColor("red", 50, 50, 0.659)).toMatch(/^oklch\(/);
  });

  it("tone=50 produces canonical L", () => {
    const parsed = parseOklch(tugColor("red", 50, 50, 0.659));
    expect(parsed!.L).toBeCloseTo(0.659, 3);
  });

  it("intensity=0 produces C=0 (achromatic)", () => {
    const parsed = parseOklch(tugColor("red", 0, 50, 0.659));
    expect(parsed!.C).toBe(0);
  });

  it("tone=0 produces L=L_DARK (0.15)", () => {
    const parsed = parseOklch(tugColor("red", 50, 0, 0.659));
    expect(parsed!.L).toBeCloseTo(L_DARK, 3);
  });

  it("tone=100 produces L=L_LIGHT (0.96)", () => {
    const parsed = parseOklch(tugColor("red", 50, 100, 0.659));
    expect(parsed!.L).toBeCloseTo(L_LIGHT, 3);
  });

  it("intensity=100 with no peakChroma gives C = MAX_CHROMA_FOR_HUE['red'] * PEAK_C_SCALE", () => {
    const parsed = parseOklch(tugColor("red", 100, 50, 0.659));
    expect(parsed!.C).toBeCloseTo(MAX_CHROMA_FOR_HUE["red"] * PEAK_C_SCALE, 4);
  });

  it("explicit peakChroma=0.5 overrides default", () => {
    const parsed = parseOklch(tugColor("red", 100, 50, 0.659, 0.5));
    expect(parsed!.C).toBeCloseTo(0.5, 4);
  });

  it("no peakChroma matches explicit default peakChroma", () => {
    const defaultPeak = MAX_CHROMA_FOR_HUE["red"] * PEAK_C_SCALE;
    expect(tugColor("red", 50, 50, 0.659)).toBe(tugColor("red", 50, 50, 0.659, defaultPeak));
  });

  it("all 48 hue names produce valid oklch strings at canonical (50/50)", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const result = tugColor(hueName, 50, 50, DEFAULT_CANONICAL_L[hueName]);
      expect(result).toMatch(/^oklch\(/);
      expect(parseOklch(result)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// MAX_P3_CHROMA_FOR_HUE
// ---------------------------------------------------------------------------

describe("MAX_P3_CHROMA_FOR_HUE", () => {
  it("has exactly 48 entries", () => {
    expect(Object.keys(MAX_P3_CHROMA_FOR_HUE).length).toBe(48);
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
  it("contains all 48 --tug-{hue}-h variables", () => {
    for (const hue of Object.keys(HUE_FAMILIES)) {
      expect(TUG_PALETTE_CSS).toContain(`--tug-${hue}-h:`);
    }
  });

  it("all 48 --tug-{hue}-h values match HUE_FAMILIES angles", () => {
    for (const [hue, angle] of Object.entries(HUE_FAMILIES)) {
      const pattern = new RegExp(`--tug-${hue}-h:\\s*${angle};`);
      expect(TUG_PALETTE_CSS).toMatch(pattern);
    }
  });

  it("contains all 48 --tug-{hue}-canonical-l variables", () => {
    for (const hue of Object.keys(HUE_FAMILIES)) {
      expect(TUG_PALETTE_CSS).toContain(`--tug-${hue}-canonical-l:`);
    }
  });

  it("contains all 48 --tug-{hue}-peak-c variables", () => {
    for (const hue of Object.keys(HUE_FAMILIES)) {
      expect(TUG_PALETTE_CSS).toContain(`--tug-${hue}-peak-c:`);
    }
  });

  it("total per-hue constant count is 144 (48 hues × 3 constants)", () => {
    const hVars     = (TUG_PALETTE_CSS.match(/--tug-\w+-h:\s*\d+(?:\.\d+)?;/g) ?? []).filter(v => !v.includes("peak"));
    const canonLVars = TUG_PALETTE_CSS.match(/--tug-\w+-canonical-l:\s*[\d.]+;/g) ?? [];
    const peakCVars  = TUG_PALETTE_CSS.match(/--tug-\w+-peak-c:\s*[\d.]+;/g) ?? [];
    // Only count the sRGB block (before @media if any, otherwise use full file)
    const mediaIdx = TUG_PALETTE_CSS.indexOf("@media (color-gamut: p3)");
    const srgbBlock = mediaIdx >= 0 ? TUG_PALETTE_CSS.slice(0, mediaIdx) : TUG_PALETTE_CSS;
    const srgbH      = (srgbBlock.match(/--tug-\w+-h:\s*\d+(?:\.\d+)?;/g) ?? []).filter(v => !v.includes("peak"));
    const srgbCanonL = srgbBlock.match(/--tug-\w+-canonical-l:\s*[\d.]+;/g) ?? [];
    const srgbPeakC  = srgbBlock.match(/--tug-\w+-peak-c:\s*[\d.]+;/g) ?? [];
    expect(srgbH.length).toBe(48);
    expect(srgbCanonL.length).toBe(48);
    expect(srgbPeakC.length).toBe(48);
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

describe("tug-palette.css — preset variables removed (unified into TugColor)", () => {
  // Preset CSS variables (--tug-red, --tug-red-light, etc.) have been removed
  // from tug-palette.css. They are now computed at build time by the postcss-tug-color
  // plugin from --tug-color(hue-preset) syntax in tug-base.css and theme files.

  it("does NOT contain chromatic preset variables for red (removed, use --tug-color())", () => {
    expect(TUG_PALETTE_CSS).not.toContain("--tug-red:");
    expect(TUG_PALETTE_CSS).not.toContain("--tug-red-light:");
    expect(TUG_PALETTE_CSS).not.toContain("--tug-red-dark:");
    expect(TUG_PALETTE_CSS).not.toContain("--tug-red-intense:");
    expect(TUG_PALETTE_CSS).not.toContain("--tug-red-muted:");
  });

  it("does NOT contain any chromatic preset variables for any of the 48 hues", () => {
    const presetSuffixes = ["", "-light", "-dark", "-intense", "-muted"];
    for (const hue of Object.keys(HUE_FAMILIES)) {
      for (const suffix of presetSuffixes) {
        expect(TUG_PALETTE_CSS).not.toContain(`--tug-${hue}${suffix}:`);
      }
    }
  });

  it("still contains per-hue constants (h, canonical-l, peak-c) for all 48 hues", () => {
    for (const hue of Object.keys(HUE_FAMILIES)) {
      expect(TUG_PALETTE_CSS).toContain(`--tug-${hue}-h:`);
      expect(TUG_PALETTE_CSS).toContain(`--tug-${hue}-canonical-l:`);
      expect(TUG_PALETTE_CSS).toContain(`--tug-${hue}-peak-c:`);
    }
  });

  it("does NOT contain coefficient knob variables (--tug-preset-*)", () => {
    expect(TUG_PALETTE_CSS).not.toMatch(/--tug-preset-/);
  });
});

describe("tug-palette.css — gray tone ramp and anchors", () => {
  it("contains 10 gray tone steps from --tug-gray-0 to --tug-gray-100", () => {
    const grayVars = TUG_PALETTE_CSS.match(/--tug-gray-\d+:\s*oklch\([^;]+\);/g) ?? [];
    expect(grayVars.length).toBe(11);
  });

  it("--tug-gray-0 matches L_DARK (black)", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-gray-0: oklch(0.15 0 0)");
  });

  it("--tug-gray-100 matches L_LIGHT (white)", () => {
    expect(TUG_PALETTE_CSS).toContain("--tug-gray-100: oklch(0.96 0 0)");
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

  it("all gray tone variables use C=0 (achromatic)", () => {
    const grayLines = TUG_PALETTE_CSS.match(/--tug-gray-\d+:\s*oklch\([^;]+\);/g) ?? [];
    expect(grayLines.length).toBeGreaterThan(0);
    for (const line of grayLines) {
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
// Gamut safety: all 48 hues x 5 presets
// ---------------------------------------------------------------------------

describe("Gamut safety: all 48 hues x 5 presets", () => {
  it("all 240 sRGB presets produce parseable oklch strings", () => {
    let count = 0;
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      for (const { intensity, tone } of Object.values(TUG_COLOR_PRESETS)) {
        const result = tugColor(hueName, intensity, tone, canonL);
        expect(result).toMatch(/^oklch\(/);
        expect(parseOklch(result)).not.toBeNull();
        count++;
      }
    }
    expect(count).toBe(240);
  });

  it("all 240 P3 presets produce parseable oklch strings", () => {
    let count = 0;
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL  = DEFAULT_CANONICAL_L[hueName];
      const p3PeakC = MAX_P3_CHROMA_FOR_HUE[hueName] * PEAK_C_SCALE;
      for (const { intensity, tone } of Object.values(TUG_COLOR_PRESETS)) {
        const result = tugColor(hueName, intensity, tone, canonL, p3PeakC);
        expect(result).toMatch(/^oklch\(/);
        expect(parseOklch(result)).not.toBeNull();
        count++;
      }
    }
    expect(count).toBe(240);
  });
});

// ---------------------------------------------------------------------------
// oklchToTugColor() and tugColorPretty()
// ---------------------------------------------------------------------------

describe("oklchToTugColor()", () => {
  it("round-trip: all 48 hues at intensity=50, tone=50 recover exact hue name and intensity/tone", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const oklch = tugColor(hueName, 50, 50, canonL);
      const result = oklchToTugColor(oklch);
      expect(result.hue).toBe(hueName);
      expect(result.intensity).toBe(50);
      expect(result.tone).toBe(50);
    }
  });

  it("round-trip edge values: intensity=0, intensity=100, tone=0, tone=100", () => {
    const hueName = "blue";
    const canonL = DEFAULT_CANONICAL_L[hueName];

    const r0 = oklchToTugColor(tugColor(hueName, 0, 50, canonL));
    expect(r0.hue).toBe(hueName);
    expect(r0.intensity).toBe(0);
    expect(r0.tone).toBe(50);

    const r100 = oklchToTugColor(tugColor(hueName, 100, 50, canonL));
    expect(r100.hue).toBe(hueName);
    expect(r100.intensity).toBe(100);
    expect(r100.tone).toBe(50);

    const rV0 = oklchToTugColor(tugColor(hueName, 50, 0, canonL));
    expect(rV0.hue).toBe(hueName);
    expect(rV0.intensity).toBe(50);
    expect(rV0.tone).toBe(0);

    const rV100 = oklchToTugColor(tugColor(hueName, 50, 100, canonL));
    expect(rV100.hue).toBe(hueName);
    expect(rV100.intensity).toBe(50);
    expect(rV100.tone).toBe(100);
  });

  it("raw angle test: oklch at hue angle 96 returns closest 144-vocab name (yellow-chartreuse at 94.17°)", () => {
    // hue angle 96 — with 144-entry vocabulary, yellow-chartreuse at 94.17° is the closest (diff=1.83°)
    const oklch = "oklch(0.5 0.05 96)";
    const result = oklchToTugColor(oklch);
    expect(result.hue).toBe("yellow-chartreuse");
  });

  it("round-trip: all 48 hues at intensity=20, tone=85 recover correct hue name", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const oklch = tugColor(hueName, 20, 85, canonL);
      const result = oklchToTugColor(oklch);
      expect(result.hue).toBe(hueName);
      expect(result.intensity).toBe(20);
      expect(result.tone).toBe(85);
    }
  });

  it("returns closest 144-vocab hue name for any angle (no hue-NNN fallback in 48-color system)", () => {
    // With 144 entries (48 base + 96 hyphenated), all angles are within ~4° of a named hue.
    // angle 96 is 1.83° from yellow-chartreuse (94.17°) — always returns a named form.
    const result = oklchToTugColor("oklch(0.7 0.08 96)");
    expect(result.hue).toBe("yellow-chartreuse");
  });

  it("returns the closest 144-vocab entry for a given angle", () => {
    // blue is at 230°, blue-sapphire at 233.33°, sapphire-blue at 236.67°.
    // angle 234 is 0.67° from blue-sapphire — closest in the 144-entry vocabulary.
    const result = oklchToTugColor("oklch(0.7 0.08 234)");
    expect(result.hue).toBe("blue-sapphire");
  });

  it("returns valid {hue, intensity, tone} for an invalid oklch string", () => {
    const result = oklchToTugColor("not-oklch");
    expect(result).toHaveProperty("hue");
    expect(result).toHaveProperty("intensity");
    expect(result).toHaveProperty("tone");
  });
});

describe("tugColorPretty()", () => {
  it("formats named hue as 'blue intensity=5 tone=13'", () => {
    // blue at angle 230, within 5 deg threshold
    const oklch = tugColor("blue", 5, 13, DEFAULT_CANONICAL_L["blue"]);
    const result = tugColorPretty(oklch);
    expect(result).toMatch(/^blue intensity=\d+ tone=\d+/);
    expect(result).toBe("blue intensity=5 tone=13");
  });

  it("formats any angle as a named hue (no hue-NNN fallback in 48-color system)", () => {
    // angle 96: closest in 144-vocab is yellow-chartreuse at 94.17° (diff=1.83°)
    const result = tugColorPretty("oklch(0.5 0.05 96)");
    expect(result).toMatch(/^yellow-chartreuse intensity=\d+ tone=\d+$/);
  });

  it("round-trip: tugColorPretty(tugColor(hue, intensity, tone)) contains correct hue name", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const oklch = tugColor(hueName, 50, 50, canonL);
      const pretty = tugColorPretty(oklch);
      expect(pretty).toMatch(new RegExp(`^${hueName} `));
    }
  });
});

// ---------------------------------------------------------------------------
// NAMED_GRAYS
// ---------------------------------------------------------------------------

describe("NAMED_GRAYS", () => {
  it("has exactly 9 entries", () => {
    expect(Object.keys(NAMED_GRAYS).length).toBe(9);
  });

  it("contains all expected names with correct tone values", () => {
    expect(NAMED_GRAYS["paper"]).toBe(10);
    expect(NAMED_GRAYS["linen"]).toBe(20);
    expect(NAMED_GRAYS["parchment"]).toBe(30);
    expect(NAMED_GRAYS["vellum"]).toBe(40);
    expect(NAMED_GRAYS["graphite"]).toBe(50);
    expect(NAMED_GRAYS["carbon"]).toBe(60);
    expect(NAMED_GRAYS["charcoal"]).toBe(70);
    expect(NAMED_GRAYS["ink"]).toBe(80);
    expect(NAMED_GRAYS["pitch"]).toBe(90);
  });

  it("tone values are multiples of 10 in the range [10, 90]", () => {
    for (const [name, tone] of Object.entries(NAMED_GRAYS)) {
      expect(tone).toBeGreaterThanOrEqual(10);
      expect(tone).toBeLessThanOrEqual(90);
      expect(tone % 10).toBe(0);
      void name;
    }
  });
});

// ---------------------------------------------------------------------------
// ACHROMATIC_SEQUENCE
// ---------------------------------------------------------------------------

describe("ACHROMATIC_SEQUENCE", () => {
  it("has exactly 11 entries", () => {
    expect(ACHROMATIC_SEQUENCE.length).toBe(11);
  });

  it("starts with 'black' and ends with 'white'", () => {
    expect(ACHROMATIC_SEQUENCE[0]).toBe("black");
    expect(ACHROMATIC_SEQUENCE[ACHROMATIC_SEQUENCE.length - 1]).toBe("white");
  });

  it("contains all 9 named grays in the correct order", () => {
    const expectedOrder = ["paper", "linen", "parchment", "vellum", "graphite", "carbon", "charcoal", "ink", "pitch"];
    const seqWithoutEndpoints = ACHROMATIC_SEQUENCE.slice(1, -1);
    expect(seqWithoutEndpoints).toEqual(expectedOrder);
  });

  it("does not include 'gray' (pseudo-hue is excluded from achromatic adjacency)", () => {
    expect(ACHROMATIC_SEQUENCE.includes("gray")).toBe(false);
  });

  it("does not include 'transparent' (transparent is excluded from all adjacency)", () => {
    expect(ACHROMATIC_SEQUENCE.includes("transparent")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ACHROMATIC_L_VALUES
// ---------------------------------------------------------------------------

describe("ACHROMATIC_L_VALUES", () => {
  it("has exactly 11 entries (black + 9 named grays + white)", () => {
    expect(Object.keys(ACHROMATIC_L_VALUES).length).toBe(11);
  });

  it("black=0 and white=1", () => {
    expect(ACHROMATIC_L_VALUES["black"]).toBe(0);
    expect(ACHROMATIC_L_VALUES["white"]).toBe(1);
  });

  it("L values match independently computed piecewise formula for each named gray tone", () => {
    // Formula: L = L_DARK + min(tone,50)*(0.5 - L_DARK)/50 + max(tone-50,0)*(L_LIGHT - 0.5)/50
    // With L_DARK=0.15, L_LIGHT=0.96
    const L_DARK_VAL = 0.15;
    const L_LIGHT_VAL = 0.96;
    const canonL = 0.5;
    function computeL(tone: number): number {
      return L_DARK_VAL
        + Math.min(tone, 50) * (canonL - L_DARK_VAL) / 50
        + Math.max(tone - 50, 0) * (L_LIGHT_VAL - canonL) / 50;
    }
    for (const [name, tone] of Object.entries(NAMED_GRAYS)) {
      const expected = computeL(tone);
      const actual = ACHROMATIC_L_VALUES[name];
      expect(actual).toBeDefined();
      expect(actual).toBeCloseTo(expected, 3);
    }
  });

  it("L values are strictly increasing across the achromatic sequence", () => {
    for (let i = 0; i < ACHROMATIC_SEQUENCE.length - 1; i++) {
      const lA = ACHROMATIC_L_VALUES[ACHROMATIC_SEQUENCE[i]];
      const lB = ACHROMATIC_L_VALUES[ACHROMATIC_SEQUENCE[i + 1]];
      expect(lA).toBeLessThan(lB);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveAchromaticAdjacency()
// ---------------------------------------------------------------------------

describe("resolveAchromaticAdjacency()", () => {
  it("paper-linen returns approximately 0.2433 ((2/3)*0.22 + (1/3)*0.29)", () => {
    const result = resolveAchromaticAdjacency("paper", "linen");
    expect(result).toBeCloseTo(0.2433, 3);
  });

  it("linen-paper returns approximately 0.2667 ((2/3)*0.29 + (1/3)*0.22)", () => {
    const result = resolveAchromaticAdjacency("linen", "paper");
    expect(result).toBeCloseTo(0.2667, 3);
  });

  it("paper-linen and linen-paper produce different values (asymmetric)", () => {
    const pl = resolveAchromaticAdjacency("paper", "linen");
    const lp = resolveAchromaticAdjacency("linen", "paper");
    expect(pl).not.toBe(lp);
    expect(pl).toBeLessThan(lp);
  });

  it("black-paper returns approximately 0.0733 ((2/3)*0 + (1/3)*0.22)", () => {
    const result = resolveAchromaticAdjacency("black", "paper");
    expect(result).toBeCloseTo(0.0733, 3);
  });

  it("pitch-white returns approximately 0.912 ((2/3)*0.868 + (1/3)*1)", () => {
    const result = resolveAchromaticAdjacency("pitch", "white");
    expect(result).toBeCloseTo(0.912, 3);
  });

  it("throws for unknown achromatic names", () => {
    expect(() => resolveAchromaticAdjacency("notacolor", "paper")).toThrow();
    expect(() => resolveAchromaticAdjacency("paper", "notacolor")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// isAchromaticAdjacent()
// ---------------------------------------------------------------------------

describe("isAchromaticAdjacent()", () => {
  it("paper and linen are adjacent (distance=1)", () => {
    expect(isAchromaticAdjacent("paper", "linen")).toBe(true);
  });

  it("linen and paper are adjacent (symmetric)", () => {
    expect(isAchromaticAdjacent("linen", "paper")).toBe(true);
  });

  it("paper and parchment are not adjacent (distance=2)", () => {
    expect(isAchromaticAdjacent("paper", "parchment")).toBe(false);
  });

  it("black and white are not adjacent (distance=10)", () => {
    expect(isAchromaticAdjacent("black", "white")).toBe(false);
  });

  it("black and paper are adjacent (distance=1, at the dark end)", () => {
    expect(isAchromaticAdjacent("black", "paper")).toBe(true);
  });

  it("pitch and white are adjacent (distance=1, at the light end)", () => {
    expect(isAchromaticAdjacent("pitch", "white")).toBe(true);
  });

  it("unknown achromatic name returns false", () => {
    expect(isAchromaticAdjacent("notacolor", "paper")).toBe(false);
    expect(isAchromaticAdjacent("paper", "notacolor")).toBe(false);
  });

  it("all consecutive pairs in ACHROMATIC_SEQUENCE are adjacent", () => {
    for (let i = 0; i < ACHROMATIC_SEQUENCE.length - 1; i++) {
      const a = ACHROMATIC_SEQUENCE[i];
      const b = ACHROMATIC_SEQUENCE[i + 1];
      expect(isAchromaticAdjacent(a, b)).toBe(true);
    }
  });

  it("no non-consecutive pairs in ACHROMATIC_SEQUENCE are adjacent (distance≥2)", () => {
    for (let i = 0; i < ACHROMATIC_SEQUENCE.length; i++) {
      for (let j = 0; j < ACHROMATIC_SEQUENCE.length; j++) {
        if (Math.abs(i - j) >= 2) {
          expect(isAchromaticAdjacent(ACHROMATIC_SEQUENCE[i], ACHROMATIC_SEQUENCE[j])).toBe(false);
        }
      }
    }
  });
});
