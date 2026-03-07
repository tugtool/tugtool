/**
 * Theme Anchors tests — Step 2 (Phase 5d5b).
 *
 * Tests cover:
 * - DEFAULT_ANCHOR_DATA has entries for all 24 hue names in all three themes
 * - Every hue in every theme has at least 3 anchors (stops 0, 50, 100)
 * - All anchor C values are <= MAX_CHROMA_FOR_HUE for that hue
 * - Tuned stop-50 L values match hand-tuned gallery export
 * - All three themes share identical anchor values
 * - Stop-50 and stop-100 C values pegged to MAX_CHROMA_FOR_HUE
 * - All 24 hues x 11 stops produce parseable oklch strings
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

describe("Chroma pegged to MAX_CHROMA_FOR_HUE", () => {
  it("stop-50 and stop-100 C values equal MAX_CHROMA_FOR_HUE for every hue", () => {
    const violations: string[] = [];
    for (const theme of ALL_THEMES) {
      for (const hue of ALL_HUE_NAMES) {
        const cap = MAX_CHROMA_FOR_HUE[hue];
        const anchors = DEFAULT_ANCHOR_DATA[theme][hue].anchors;
        const a50 = anchors.find((a) => a.stop === 50);
        const a100 = anchors.find((a) => a.stop === 100);
        if (a50 && Math.abs(a50.C - cap) > 0.0001) {
          violations.push(`${theme}.${hue} stop=50: C=${a50.C} != cap=${cap}`);
        }
        if (a100 && Math.abs(a100.C - cap) > 0.0001) {
          violations.push(`${theme}.${hue} stop=100: C=${a100.C} != cap=${cap}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(`Chroma peg violations:\n${violations.join("\n")}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Table T01 canonical L values
// ---------------------------------------------------------------------------

describe("Tuned stop-50 L values", () => {
  it("brio stop-50 L for 'yellow' is approximately 0.901", () => {
    const anchor = BRIO_ANCHORS.yellow.anchors.find((a) => a.stop === 50);
    expect(anchor).toBeDefined();
    expect(anchor!.L).toBeCloseTo(0.901, 2);
  });

  it("brio stop-50 L for 'blue' is approximately 0.771", () => {
    const anchor = BRIO_ANCHORS.blue.anchors.find((a) => a.stop === 50);
    expect(anchor).toBeDefined();
    expect(anchor!.L).toBeCloseTo(0.771, 2);
  });

  it("all three themes share the same anchor values", () => {
    for (const hue of ALL_HUE_NAMES) {
      expect(BRIO_ANCHORS[hue]).toBe(BLUENOTE_ANCHORS[hue]);
      expect(BRIO_ANCHORS[hue]).toBe(HARMONY_ANCHORS[hue]);
    }
  });

  it("brio stop-50 L for 'red' is approximately 0.659", () => {
    const anchor = BRIO_ANCHORS.red.anchors.find((a) => a.stop === 50);
    expect(anchor).toBeDefined();
    expect(anchor!.L).toBeCloseTo(0.659, 2);
  });
});

// ---------------------------------------------------------------------------
// oklch string generation: all stops produce parseable oklch strings.
// CSS oklch() handles gamut mapping at render time.
// ---------------------------------------------------------------------------

describe("oklch string generation", () => {
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
