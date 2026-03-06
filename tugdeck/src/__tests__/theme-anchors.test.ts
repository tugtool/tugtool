/**
 * Theme Anchors tests — Step 2 (Phase 5d5b).
 *
 * Tests cover:
 * - DEFAULT_ANCHOR_DATA has entries for all 24 hue names in all three themes
 * - Every hue in every theme has at least 3 anchors (stops 0, 50, 100)
 * - All anchor C values are <= MAX_CHROMA_FOR_HUE for that hue
 * - Brio stop-50 L for "yellow" is approximately 0.90 (Table T01 canonical value)
 * - Brio stop-50 L for "blue" is approximately 0.55 (Table T01 canonical value)
 * - Bluenote stop-50 L for "blue" is higher than brio stop-50 L for "blue"
 * - All 24 hues x 11 stops produce sRGB-safe oklch values via tugAnchoredColor with brio anchors
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";

import { HUE_FAMILIES, MAX_CHROMA_FOR_HUE, tugAnchoredColor } from "@/components/tugways/palette-engine";
import {
  DEFAULT_ANCHOR_DATA,
  BRIO_ANCHORS,
  BLUENOTE_ANCHORS,
  HARMONY_ANCHORS,
} from "@/components/tugways/theme-anchors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STANDARD_STOPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Parse an oklch() string into its numeric components. */
function parseOklch(s: string): { L: number; C: number; h: number } | null {
  const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!m) return null;
  return { L: parseFloat(m[1]), C: parseFloat(m[2]), h: parseFloat(m[3]) };
}

/**
 * Convert OKLCH to linear sRGB for gamut safety checks.
 * Mirrors the private implementation in palette-engine.ts.
 */
function oklchToLinearSRGB(L: number, C: number, h: number): { r: number; g: number; b: number } {
  const hRad = (h * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const lHat = L + 0.3963377774 * a + 0.2158037573 * b;
  const mHat = L - 0.1055613458 * a - 0.0638541728 * b;
  const sHat = L - 0.0894841775 * a - 1.2914855480 * b;

  const lLMS = lHat * lHat * lHat;
  const mLMS = mHat * mHat * mHat;
  const sLMS = sHat * sHat * sHat;

  const r = 4.0767416621 * lLMS - 3.3077115913 * mLMS + 0.2309699292 * sLMS;
  const g = -1.2684380046 * lLMS + 2.6097574011 * mLMS - 0.3413193965 * sLMS;
  const bVal = -0.0041960863 * lLMS - 0.7034186147 * mLMS + 1.7076147010 * sLMS;

  return { r, g, b: bVal };
}

function isInSRGBGamut(L: number, C: number, h: number): boolean {
  const { r, g, b } = oklchToLinearSRGB(L, C, h);
  const eps = 0.005;
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps;
}

const ALL_HUE_NAMES = Object.keys(HUE_FAMILIES);
const ALL_THEMES = ["brio", "bluenote", "harmony"] as const;

// ---------------------------------------------------------------------------
// DEFAULT_ANCHOR_DATA completeness
// ---------------------------------------------------------------------------

describe("DEFAULT_ANCHOR_DATA completeness", () => {
  it("DEFAULT_ANCHOR_DATA.brio has entries for all 24 hue names", () => {
    expect(Object.keys(DEFAULT_ANCHOR_DATA.brio).length).toBe(24);
    for (const hue of ALL_HUE_NAMES) {
      expect(DEFAULT_ANCHOR_DATA.brio[hue]).toBeDefined();
    }
  });

  it("DEFAULT_ANCHOR_DATA.bluenote has entries for all 24 hue names", () => {
    expect(Object.keys(DEFAULT_ANCHOR_DATA.bluenote).length).toBe(24);
    for (const hue of ALL_HUE_NAMES) {
      expect(DEFAULT_ANCHOR_DATA.bluenote[hue]).toBeDefined();
    }
  });

  it("DEFAULT_ANCHOR_DATA.harmony has entries for all 24 hue names", () => {
    expect(Object.keys(DEFAULT_ANCHOR_DATA.harmony).length).toBe(24);
    for (const hue of ALL_HUE_NAMES) {
      expect(DEFAULT_ANCHOR_DATA.harmony[hue]).toBeDefined();
    }
  });

  it("exports BRIO_ANCHORS, BLUENOTE_ANCHORS, HARMONY_ANCHORS individually", () => {
    expect(BRIO_ANCHORS).toBeDefined();
    expect(BLUENOTE_ANCHORS).toBeDefined();
    expect(HARMONY_ANCHORS).toBeDefined();
    // They are the same objects as in DEFAULT_ANCHOR_DATA
    expect(DEFAULT_ANCHOR_DATA.brio).toBe(BRIO_ANCHORS);
    expect(DEFAULT_ANCHOR_DATA.bluenote).toBe(BLUENOTE_ANCHORS);
    expect(DEFAULT_ANCHOR_DATA.harmony).toBe(HARMONY_ANCHORS);
  });
});

// ---------------------------------------------------------------------------
// Minimum anchor coverage (stops 0, 50, 100 for every hue and theme)
// ---------------------------------------------------------------------------

describe("Minimum anchor coverage", () => {
  it("every hue in every theme has at least 3 anchors", () => {
    const violations: string[] = [];
    for (const theme of ALL_THEMES) {
      for (const hue of ALL_HUE_NAMES) {
        const entry = DEFAULT_ANCHOR_DATA[theme][hue];
        if (!entry || entry.anchors.length < 3) {
          violations.push(`${theme}.${hue}: only ${entry?.anchors.length ?? 0} anchors`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(`Insufficient anchors:\n${violations.join("\n")}`);
    }
  });

  it("every hue in every theme has anchors at stops 0, 50, and 100", () => {
    const violations: string[] = [];
    for (const theme of ALL_THEMES) {
      for (const hue of ALL_HUE_NAMES) {
        const stops = DEFAULT_ANCHOR_DATA[theme][hue].anchors.map((a) => a.stop);
        if (!stops.includes(0))   violations.push(`${theme}.${hue}: missing stop 0`);
        if (!stops.includes(50))  violations.push(`${theme}.${hue}: missing stop 50`);
        if (!stops.includes(100)) violations.push(`${theme}.${hue}: missing stop 100`);
      }
    }
    if (violations.length > 0) {
      throw new Error(`Missing required stops:\n${violations.join("\n")}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Chroma cap enforcement
// ---------------------------------------------------------------------------

describe("Chroma cap enforcement", () => {
  it("all anchor C values are <= MAX_CHROMA_FOR_HUE for that hue", () => {
    const violations: string[] = [];
    for (const theme of ALL_THEMES) {
      for (const hue of ALL_HUE_NAMES) {
        const cap = MAX_CHROMA_FOR_HUE[hue];
        for (const anchor of DEFAULT_ANCHOR_DATA[theme][hue].anchors) {
          if (anchor.C > cap + 0.0001) {
            violations.push(
              `${theme}.${hue} stop=${anchor.stop}: C=${anchor.C} > cap=${cap}`,
            );
          }
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(`Chroma cap violations:\n${violations.join("\n")}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Table T01 canonical L values
// ---------------------------------------------------------------------------

describe("Table T01 canonical L values", () => {
  it("brio stop-50 L for 'yellow' is approximately 0.90", () => {
    const anchor = BRIO_ANCHORS.yellow.anchors.find((a) => a.stop === 50);
    expect(anchor).toBeDefined();
    expect(anchor!.L).toBeCloseTo(0.90, 2);
  });

  it("brio stop-50 L for 'blue' is approximately 0.55", () => {
    const anchor = BRIO_ANCHORS.blue.anchors.find((a) => a.stop === 50);
    expect(anchor).toBeDefined();
    expect(anchor!.L).toBeCloseTo(0.55, 2);
  });

  it("bluenote stop-50 L for 'blue' is higher than brio stop-50 L for 'blue'", () => {
    const brioAnchor = BRIO_ANCHORS.blue.anchors.find((a) => a.stop === 50);
    const bluenoteAnchor = BLUENOTE_ANCHORS.blue.anchors.find((a) => a.stop === 50);
    expect(brioAnchor).toBeDefined();
    expect(bluenoteAnchor).toBeDefined();
    expect(bluenoteAnchor!.L).toBeGreaterThan(brioAnchor!.L);
  });

  it("brio stop-50 L for 'red' is approximately 0.65", () => {
    const anchor = BRIO_ANCHORS.red.anchors.find((a) => a.stop === 50);
    expect(anchor).toBeDefined();
    expect(anchor!.L).toBeCloseTo(0.65, 2);
  });

  it("harmony stop-50 L for 'blue' is between brio and bluenote values", () => {
    const brioL = BRIO_ANCHORS.blue.anchors.find((a) => a.stop === 50)!.L;
    const bluenoteL = BLUENOTE_ANCHORS.blue.anchors.find((a) => a.stop === 50)!.L;
    const harmonyL = HARMONY_ANCHORS.blue.anchors.find((a) => a.stop === 50)!.L;
    expect(harmonyL).toBeGreaterThan(brioL - 0.001);
    expect(harmonyL).toBeLessThan(bluenoteL + 0.001);
  });
});

// ---------------------------------------------------------------------------
// sRGB gamut safety: all 24 hues x 11 standard stops via tugAnchoredColor
// ---------------------------------------------------------------------------

describe("Gamut safety via tugAnchoredColor with brio anchors", () => {
  it("all 24 hues x 11 standard stops produce sRGB-safe oklch values", () => {
    const violations: string[] = [];
    for (const [hue, angle] of Object.entries(HUE_FAMILIES)) {
      const hueAnchors = BRIO_ANCHORS[hue];
      expect(hueAnchors).toBeDefined();
      for (const stop of STANDARD_STOPS) {
        const colorStr = tugAnchoredColor(hue, stop, hueAnchors);
        const parsed = parseOklch(colorStr);
        if (!parsed) {
          violations.push(`${hue}@${stop}: failed to parse "${colorStr}"`);
          continue;
        }
        if (!isInSRGBGamut(parsed.L, parsed.C, angle)) {
          const { r, g, b } = oklchToLinearSRGB(parsed.L, parsed.C, angle);
          violations.push(
            `${hue}@${stop}: out of gamut r=${r.toFixed(3)} g=${g.toFixed(3)} b=${b.toFixed(3)}`,
          );
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(`Gamut violations:\n${violations.join("\n")}`);
    }
  });

  it("produces 264 parseable oklch strings (24 hues x 11 stops)", () => {
    let count = 0;
    for (const hue of ALL_HUE_NAMES) {
      const hueAnchors = BRIO_ANCHORS[hue];
      for (const stop of STANDARD_STOPS) {
        const result = tugAnchoredColor(hue, stop, hueAnchors);
        expect(result).toMatch(/^oklch\(/);
        expect(parseOklch(result)).not.toBeNull();
        count++;
      }
    }
    expect(count).toBe(24 * 11); // 264
  });
});
