/**
 * Tests for tug-color-parser — the tokenizer and parser for --tug-color() notation.
 *
 * --tug-color() is thin sugar over oklch(): a named hue plus OKLCH l / c / a, where
 * l/c/a are authored in HUNDREDTHS (l: 30 → oklch L 0.30) and stored as fractions.
 *
 * Covers:
 * - Chromatic hues require explicit l + c; labeled and positional forms
 * - Adjacency syntax (cobalt-indigo) and non-adjacent / extra-segment errors
 * - Fixed achromatics (black, white, named grays, transparent) take no l/c
 * - gray pseudo-hue requires l, forces c=0
 * - Range validation in hundredths (l/a 0–100, c 0–50)
 * - Ignored-argument warnings; error reporting; tokenizer edges
 */
import { describe, it, expect } from "bun:test";
import { parseTugColor, findTugColorCalls, findTugColorCallsWithWarnings } from "../../tug-color-parser";
import type { TugColorParsed } from "../../tug-color-parser";
import { ADJACENCY_RING, NAMED_GRAYS } from "@/components/tugways/palette-engine";

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

describe("chromatic hues — labeled l/c/a in hundredths", () => {
  it("parses l + c, storing oklch fractions", () => {
    const v = expectOk("indigo, l: 30, c: 8");
    expect(v.color).toEqual({ name: "indigo" });
    expect(v.lightness).toBeCloseTo(0.3, 10);
    expect(v.chroma).toBeCloseTo(0.08, 10);
    expect(v.alpha).toBe(1);
  });

  it("parses l + c + a", () => {
    const v = expectOk("red, l: 66, c: 22, a: 50");
    expect(v.lightness).toBeCloseTo(0.66, 10);
    expect(v.chroma).toBeCloseTo(0.22, 10);
    expect(v.alpha).toBeCloseTo(0.5, 10);
  });

  it("labels may appear in any order", () => {
    const v = expectOk("blue, c: 10, a: 80, l: 40");
    expect(v.lightness).toBeCloseTo(0.4, 10);
    expect(v.chroma).toBeCloseTo(0.1, 10);
    expect(v.alpha).toBeCloseTo(0.8, 10);
  });

  it("accepts positional l, c, a after the color", () => {
    const v = expectOk("violet, 50, 12, 90");
    expect(v.lightness).toBeCloseTo(0.5, 10);
    expect(v.chroma).toBeCloseTo(0.12, 10);
    expect(v.alpha).toBeCloseTo(0.9, 10);
  });

  it("normalizes uppercase hue names", () => {
    expect(expectOk("Cobalt, l: 30, c: 5").color.name).toBe("cobalt");
  });

  it("requires lightness for a chromatic hue", () => {
    expect(expectErr("indigo, c: 8").join()).toContain("lightness");
  });

  it("requires chroma for a chromatic hue", () => {
    expect(expectErr("indigo, l: 30").join()).toContain("chroma");
  });
});

describe("adjacency", () => {
  it("parses a ring-adjacent pair, keeping both names", () => {
    const v = expectOk("cobalt-indigo, l: 30, c: 5");
    expect(v.color).toEqual({ name: "cobalt", adjacentName: "indigo" });
  });

  it("rejects a non-adjacent pair", () => {
    expect(expectErr("blue-red, l: 30, c: 5").join()).toContain("not adjacent");
  });

  it("rejects a third hue segment", () => {
    expect(expectErr("cobalt-indigo-violet, l: 30, c: 5").length).toBeGreaterThan(0);
  });
});

describe("fixed achromatics", () => {
  it("black takes no l/c and defaults alpha to 1", () => {
    const v = expectOk("black");
    expect(v.color.name).toBe("black");
    expect(v.alpha).toBe(1);
  });

  it("white honors alpha", () => {
    expect(expectOk("white, a: 8").alpha).toBeCloseTo(0.08, 10);
  });

  it("named grays parse bare", () => {
    expect(expectOk("charcoal").color.name).toBe("charcoal");
  });

  it("transparent parses bare", () => {
    expect(expectOk("transparent").color.name).toBe("transparent");
  });

  it("warns when l/c supplied to a fixed achromatic", () => {
    const r = parseTugColor("paper, l: 40", KNOWN_HUES, ADJACENCY_RING);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.warnings ?? []).map((w) => w.message).join()).toContain("ignored");
  });
});

describe("gray pseudo-hue", () => {
  it("requires lightness, forces achromatic chroma", () => {
    const v = expectOk("gray, l: 43");
    expect(v.color.name).toBe("gray");
    expect(v.lightness).toBeCloseTo(0.43, 10);
    expect(v.chroma).toBe(0);
  });

  it("errors without lightness", () => {
    expect(expectErr("gray").join()).toContain("lightness");
  });

  it("warns when chroma supplied to gray", () => {
    const r = parseTugColor("gray, l: 40, c: 10", KNOWN_HUES, ADJACENCY_RING);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.warnings ?? []).map((w) => w.message).join()).toContain("chroma");
  });
});

describe("range + error reporting (hundredths)", () => {
  it("rejects lightness > 100", () => {
    expect(expectErr("red, l: 150, c: 10").join()).toContain("range");
  });

  it("rejects negative chroma", () => {
    expect(expectErr("red, l: 50, c: -10").join()).toContain("range");
  });

  it("rejects chroma above the ceiling (50)", () => {
    expect(expectErr("red, l: 50, c: 60").join()).toContain("range");
  });

  it("rejects an unknown color", () => {
    expect(expectErr("notacolor, l: 50, c: 10").join()).toContain("Unknown color");
  });

  it("rejects an unknown label", () => {
    expect(expectErr("red, x: 5").join()).toContain("label");
  });

  it("rejects '+' (offset syntax removed)", () => {
    expect(expectErr("red+5, l: 50, c: 10").length).toBeGreaterThan(0);
  });
});

describe("findTugColorCalls", () => {
  it("finds a single call", () => {
    const calls = findTugColorCalls("--tug-color(indigo, l: 30, c: 8)");
    expect(calls).toHaveLength(1);
    expect(calls[0].inner).toBe("indigo, l: 30, c: 8");
  });

  it("finds multiple calls in one value", () => {
    const calls = findTugColorCalls(
      "linear-gradient(--tug-color(red, l: 60, c: 20), --tug-color(blue, l: 40, c: 10))",
    );
    expect(calls).toHaveLength(2);
  });

  it("warns on an unmatched paren", () => {
    const r: ReturnType<typeof findTugColorCallsWithWarnings> =
      findTugColorCallsWithWarnings("--tug-color(red, l: 50, c: 10");
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("tokenizer + argument edge cases", () => {
  it("decodes a CSS hex escape in the hue name (\\72 ed → red)", () => {
    expect(expectOk("\\72 ed, l: 50, c: 10").color.name).toBe("red");
  });

  it("treats NBSP (U+00A0) as whitespace", () => {
    const v = expectOk("red, l: 50, c: 10");
    expect(v.lightness).toBeCloseTo(0.5, 10);
    expect(v.chroma).toBeCloseTo(0.1, 10);
  });

  it("rejects a positional argument after a labeled one", () => {
    expect(expectErr("red, l: 50, 10").join()).toContain("Positional argument after labeled");
  });

  it("rejects a duplicate label", () => {
    expect(expectErr("red, l: 50, l: 30, c: 10").join()).toContain("Duplicate value");
  });

  it("rejects a bare '-' with no number", () => {
    expect(expectErr("red, l: -, c: 10").join()).toContain("Bare '-'");
  });

  it("rejects a fractional value (whole hundredths only)", () => {
    expect(expectErr("red, l: 30.5, c: 8").join()).toContain("whole number");
  });

  it("rejects an empty call", () => {
    const r = parseTugColor("", KNOWN_HUES, ADJACENCY_RING);
    expect(r.ok).toBe(false);
  });
});
