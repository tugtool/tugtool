/**
 * Tests for tug-color-parser — the tokenizer and parser for --tug-color() notation.
 *
 * --tug-color() is thin sugar over oklch(): a named hue plus l / c / a authored as
 * integers on one 0–1000 scale. l/a are linear (l: 300 → oklch L 0.30); chroma is
 * gamut-relative (c: 1000 → the P3 chroma ceiling at that hue+lightness, c: 500 →
 * half). Stored as oklch fractions.
 *
 * Covers:
 * - Chromatic hues require explicit l + c; labeled and positional forms
 * - Adjacency syntax (cobalt-indigo) and non-adjacent / extra-segment errors
 * - Fixed achromatics (black, white, named grays, transparent) take no l/c
 * - gray pseudo-hue requires l, forces c=0
 * - Range validation (l/c/a all 0–1000)
 * - Ignored-argument warnings; error reporting; tokenizer edges
 */
import { describe, it, expect } from "bun:test";
import { parseTugColor, findTugColorCalls, findTugColorCallsWithWarnings } from "../../tug-color-parser";
import type { TugColorParsed } from "../../tug-color-parser";
import {
  ADJACENCY_RING, NAMED_GRAYS, HUE_FAMILIES,
  isInP3Gamut, maxChromaInGamut, resolveHueAngle,
} from "@/components/tugways/palette-engine";

/** The absolute oklch C that authored chroma `c` resolves to at this hue + lightness. */
const expectChroma = (hue: string, L: number, c: number, adjacent?: string): number =>
  (c / 1000) * maxChromaInGamut(L, resolveHueAngle(hue, adjacent)!, isInP3Gamut);

const KNOWN_HUES = new Set([
  ...ADJACENCY_RING,
  "black", "white", "gray", "transparent",
  ...NAMED_GRAYS,
]);

/** Assert a successful parse (with the adjacency ring) and return the value. */
function expectOk(input: string): TugColorParsed {
  const result = parseTugColor(input, KNOWN_HUES, ADJACENCY_RING);
  if (!result.ok) {
    throw new Error(
      `Expected ok parse for '${input}', got errors:\n` +
      result.errors.map((e) => `  - ${e.message}`).join("\n"),
    );
  }
  return result.value;
}

/** Assert a failed parse and return the error messages. */
function expectErr(input: string): string[] {
  const result = parseTugColor(input, KNOWN_HUES, ADJACENCY_RING);
  if (result.ok) throw new Error(`Expected parse error for '${input}', but it succeeded`);
  return result.errors.map((e) => e.message);
}

describe("chromatic hues — labeled l/c/a on the 0–1000 scale", () => {
  it("parses l + c, storing oklch fractions (chroma is gamut-relative)", () => {
    const v = expectOk("indigo, l: 300, c: 500");
    expect(v.color).toEqual({ name: "indigo" });
    expect(v.lightness).toBeCloseTo(0.3, 10);
    expect(v.chroma).toBeCloseTo(expectChroma("indigo", 0.3, 500), 10);
    expect(v.alpha).toBe(1);
  });

  it("parses l + c + a", () => {
    const v = expectOk("red, l: 660, c: 440, a: 500");
    expect(v.lightness).toBeCloseTo(0.66, 10);
    expect(v.chroma).toBeCloseTo(expectChroma("red", 0.66, 440), 10);
    expect(v.alpha).toBeCloseTo(0.5, 10);
  });

  it("labels may appear in any order", () => {
    const v = expectOk("blue, c: 200, a: 800, l: 400");
    expect(v.lightness).toBeCloseTo(0.4, 10);
    expect(v.chroma).toBeCloseTo(expectChroma("blue", 0.4, 200), 10);
    expect(v.alpha).toBeCloseTo(0.8, 10);
  });

  it("accepts positional l, c, a after the color", () => {
    const v = expectOk("violet, 500, 240, 900");
    expect(v.lightness).toBeCloseTo(0.5, 10);
    expect(v.chroma).toBeCloseTo(expectChroma("violet", 0.5, 240), 10);
    expect(v.alpha).toBeCloseTo(0.9, 10);
  });

  it("c: 1000 reaches the full P3 chroma ceiling at that hue + lightness", () => {
    expect(expectOk("red, l: 500, c: 1000").chroma)
      .toBeCloseTo(maxChromaInGamut(0.5, HUE_FAMILIES.red, isInP3Gamut), 10);
  });

  it("c: 500 is half the ceiling (the scale is linear in % of gamut)", () => {
    const full = expectOk("green, l: 600, c: 1000").chroma;
    expect(expectOk("green, l: 600, c: 500").chroma).toBeCloseTo(full / 2, 10);
  });

  it("normalizes uppercase hue names", () => {
    expect(expectOk("Cobalt, l: 300, c: 100").color.name).toBe("cobalt");
  });

  it("requires lightness for a chromatic hue", () => {
    expect(expectErr("indigo, c: 160").join()).toContain("lightness");
  });

  it("requires chroma for a chromatic hue", () => {
    expect(expectErr("indigo, l: 300").join()).toContain("chroma");
  });
});

describe("adjacency", () => {
  it("parses a ring-adjacent pair, keeping both names", () => {
    const v = expectOk("cobalt-indigo, l: 300, c: 50");
    expect(v.color).toEqual({ name: "cobalt", adjacentName: "indigo" });
  });

  it("rejects a non-adjacent pair", () => {
    expect(expectErr("blue-red, l: 300, c: 50").join()).toContain("not adjacent");
  });

  it("rejects a third hue segment", () => {
    expect(expectErr("cobalt-indigo-violet, l: 300, c: 50").length).toBeGreaterThan(0);
  });
});

describe("fixed achromatics", () => {
  it("black takes no l/c and defaults alpha to 1", () => {
    const v = expectOk("black");
    expect(v.color.name).toBe("black");
    expect(v.alpha).toBe(1);
  });

  it("white honors alpha", () => {
    expect(expectOk("white, a: 80").alpha).toBeCloseTo(0.08, 10);
  });

  it("named grays parse bare", () => {
    expect(expectOk("charcoal").color.name).toBe("charcoal");
  });

  it("transparent parses bare", () => {
    expect(expectOk("transparent").color.name).toBe("transparent");
  });

  it("warns when l/c supplied to a fixed achromatic", () => {
    const r = parseTugColor("paper, l: 400", KNOWN_HUES, ADJACENCY_RING);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.warnings ?? []).map((w) => w.message).join()).toContain("ignored");
  });
});

describe("gray pseudo-hue", () => {
  it("requires lightness, forces achromatic chroma", () => {
    const v = expectOk("gray, l: 430");
    expect(v.color.name).toBe("gray");
    expect(v.lightness).toBeCloseTo(0.43, 10);
    expect(v.chroma).toBe(0);
  });

  it("errors without lightness", () => {
    expect(expectErr("gray").join()).toContain("lightness");
  });

  it("warns when chroma supplied to gray", () => {
    const r = parseTugColor("gray, l: 400, c: 100", KNOWN_HUES, ADJACENCY_RING);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.warnings ?? []).map((w) => w.message).join()).toContain("chroma");
  });
});

describe("range + error reporting (l/c/a all 0–1000)", () => {
  it("rejects lightness > 1000", () => {
    expect(expectErr("red, l: 1500, c: 100").join()).toContain("range");
  });

  it("rejects negative chroma", () => {
    expect(expectErr("red, l: 500, c: -100").join()).toContain("range");
  });

  it("rejects chroma above 1000", () => {
    expect(expectErr("red, l: 500, c: 1200").join()).toContain("range");
  });

  it("rejects an unknown color", () => {
    expect(expectErr("notacolor, l: 500, c: 100").join()).toContain("Unknown color");
  });

  it("rejects an unknown label", () => {
    expect(expectErr("red, x: 50").join()).toContain("label");
  });

  it("rejects '+' (offset syntax removed)", () => {
    expect(expectErr("red+50, l: 500, c: 100").length).toBeGreaterThan(0);
  });
});

describe("findTugColorCalls", () => {
  it("finds a single call", () => {
    const calls = findTugColorCalls("--tug-color(indigo, l: 300, c: 80)");
    expect(calls).toHaveLength(1);
    expect(calls[0].inner).toBe("indigo, l: 300, c: 80");
  });

  it("finds multiple calls in one value", () => {
    const calls = findTugColorCalls(
      "linear-gradient(--tug-color(red, l: 600, c: 200), --tug-color(blue, l: 400, c: 100))",
    );
    expect(calls).toHaveLength(2);
  });

  it("warns on an unmatched paren", () => {
    const r: ReturnType<typeof findTugColorCallsWithWarnings> =
      findTugColorCallsWithWarnings("--tug-color(red, l: 500, c: 100");
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("tokenizer + argument edge cases", () => {
  it("decodes a CSS hex escape in the hue name (\\72 ed → red)", () => {
    expect(expectOk("\\72 ed, l: 500, c: 100").color.name).toBe("red");
  });

  it("treats NBSP (U+00A0) as whitespace", () => {
    const v = expectOk("red, l: 500, c: 200");
    expect(v.lightness).toBeCloseTo(0.5, 10);
    expect(v.chroma).toBeCloseTo(expectChroma("red", 0.5, 200), 10);
  });

  it("rejects a positional argument after a labeled one", () => {
    expect(expectErr("red, l: 500, 100").join()).toContain("Positional argument after labeled");
  });

  it("rejects a duplicate label", () => {
    expect(expectErr("red, l: 500, l: 300, c: 100").join()).toContain("Duplicate value");
  });

  it("rejects a bare '-' with no number", () => {
    expect(expectErr("red, l: -, c: 100").join()).toContain("Bare '-'");
  });

  it("rejects a fractional value (whole thousandths only)", () => {
    expect(expectErr("red, l: 300.5, c: 80").join()).toContain("whole number");
  });

  it("rejects an empty call", () => {
    const r = parseTugColor("", KNOWN_HUES, ADJACENCY_RING);
    expect(r.ok).toBe(false);
  });
});
