/**
 * Tests for the OKLCH gamut helpers in palette-engine (used by the gamut audit).
 *
 * Covers isInSRGBGamut / isInP3Gamut / maxChromaInGamut and the invariant that
 * P3 is a superset of sRGB.
 */
import { describe, it, expect } from "bun:test";
import {
  HUE_FAMILIES,
  isInSRGBGamut,
  isInP3Gamut,
  maxChromaInGamut,
} from "@/components/tugways/palette-engine";

const RED = HUE_FAMILIES.red;
const GREEN = HUE_FAMILIES.green;

describe("isInSRGBGamut / isInP3Gamut", () => {
  it("a low-chroma color is in both gamuts", () => {
    expect(isInSRGBGamut(0.5, 0.04, HUE_FAMILIES.blue)).toBe(true);
    expect(isInP3Gamut(0.5, 0.04, HUE_FAMILIES.blue)).toBe(true);
  });

  it("achromatic (C=0) is in gamut at any lightness", () => {
    expect(isInSRGBGamut(0.5, 0, 0)).toBe(true);
    expect(isInP3Gamut(0.92, 0, 0)).toBe(true);
  });

  it("a signal chroma (c=0.44 red) is outside both sRGB and P3", () => {
    expect(isInSRGBGamut(0.659, 0.44, RED)).toBe(false);
    expect(isInP3Gamut(0.659, 0.44, RED)).toBe(false);
  });

  it("P3 is a superset of sRGB — there is a chroma in P3 but not sRGB", () => {
    // Just past red's sRGB ceiling at this lightness, still within P3.
    const L = 0.62;
    const sMax = maxChromaInGamut(L, RED, isInSRGBGamut);
    const between = sMax + 0.02;
    expect(isInSRGBGamut(L, between, RED)).toBe(false);
    expect(isInP3Gamut(L, between, RED)).toBe(true);
  });
});

describe("maxChromaInGamut", () => {
  it("P3 ceiling is at least the sRGB ceiling for every hue", () => {
    for (const h of [RED, GREEN, HUE_FAMILIES.yellow, HUE_FAMILIES.cobalt]) {
      const s = maxChromaInGamut(0.6, h, isInSRGBGamut);
      const p = maxChromaInGamut(0.6, h, isInP3Gamut);
      expect(p).toBeGreaterThanOrEqual(s);
    }
  });

  it("the returned ceiling is in gamut and just above it is not", () => {
    const L = 0.6;
    const cap = maxChromaInGamut(L, GREEN, isInP3Gamut);
    expect(isInP3Gamut(L, cap, GREEN)).toBe(true);
    expect(isInP3Gamut(L, cap + 0.01, GREEN)).toBe(false);
  });
});
