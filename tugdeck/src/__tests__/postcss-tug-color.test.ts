/**
 * Tests for the postcss-tug-color PostCSS plugin.
 *
 * --tug-color() is thin sugar over oklch(): the plugin formats a named hue plus
 * OKLCH l / c / a (authored in hundredths) into a concrete oklch() string at build.
 *
 * Covers:
 * - Chromatic expansion: --tug-color(blue, l: 30, c: 8) → oklch(0.3 0.08 230)
 * - Adjacency: --tug-color(cobalt-indigo, l, c) (angle from resolveHyphenatedHue)
 * - Fixed achromatics: black, white, named grays, gray pseudo-hue, transparent
 * - Alpha: emitted only when < 1
 * - Multiple calls per declaration; non-tug-color passthrough
 * - Build errors: non-adjacent pairs, unknown colors, missing l/c
 */
import { describe, it, expect } from "bun:test";
import postcss from "postcss";
import postcssTugColor from "../../postcss-tug-color";
import { HUE_FAMILIES, resolveHyphenatedHue } from "@/components/tugways/palette-engine";

/** Expand a single declaration value through the plugin. */
function processDecl(value: string): string {
  const result = postcss([postcssTugColor()]).process(`a { color: ${value}; }`, { from: undefined });
  let expanded = value;
  result.root.walkDecls("color", (decl) => { expanded = decl.value; });
  return expanded;
}

/** Run the plugin and expect a build error; return the message. */
function processDeclExpectError(value: string): string {
  try {
    postcss([postcssTugColor()]).process(`a { color: ${value}; }`, { from: undefined }).css;
    throw new Error(`Expected a PostCSS error for '${value}', but it succeeded`);
  } catch (e) {
    if (e instanceof Error) return e.message;
    throw e;
  }
}

describe("chromatic expansion", () => {
  it("expands a bare hue's l/c (hundredths) onto its angle", () => {
    expect(processDecl("--tug-color(blue, l: 30, c: 8)")).toBe(`oklch(0.3 0.08 ${HUE_FAMILIES.blue})`);
  });

  it("passes lightness and chroma through verbatim", () => {
    expect(processDecl("--tug-color(red, l: 66, c: 22)")).toBe(`oklch(0.66 0.22 ${HUE_FAMILIES.red})`);
  });

  it("resolves an adjacency angle via resolveHyphenatedHue", () => {
    const h = resolveHyphenatedHue("cobalt", "indigo");
    expect(processDecl("--tug-color(cobalt-indigo, l: 30, c: 5)")).toBe(`oklch(0.3 0.05 ${h})`);
  });
});

describe("fixed achromatics", () => {
  it("black → oklch(0 0 0)", () => {
    expect(processDecl("--tug-color(black)")).toBe("oklch(0 0 0)");
  });

  it("white → oklch(1 0 0)", () => {
    expect(processDecl("--tug-color(white)")).toBe("oklch(1 0 0)");
  });

  it("named gray → fixed L, C=0", () => {
    expect(processDecl("--tug-color(charcoal)")).toBe("oklch(0.36 0 0)");
  });

  it("gray pseudo-hue → L from l, C=0", () => {
    expect(processDecl("--tug-color(gray, l: 43)")).toBe("oklch(0.43 0 0)");
  });

  it("transparent → oklch(0 0 0 / 0)", () => {
    expect(processDecl("--tug-color(transparent)")).toBe("oklch(0 0 0 / 0)");
  });
});

describe("alpha", () => {
  it("emits the / alpha suffix when alpha < 1", () => {
    expect(processDecl("--tug-color(white, a: 8)")).toBe("oklch(1 0 0 / 0.08)");
  });

  it("omits the suffix at full opacity", () => {
    expect(processDecl("--tug-color(blue, l: 40, c: 10)")).toBe(`oklch(0.4 0.1 ${HUE_FAMILIES.blue})`);
  });
});

describe("declaration handling", () => {
  it("expands multiple calls in one value", () => {
    const h1 = HUE_FAMILIES.red;
    const h2 = HUE_FAMILIES.blue;
    expect(processDecl("linear-gradient(--tug-color(red, l: 60, c: 20), --tug-color(blue, l: 40, c: 10))"))
      .toBe(`linear-gradient(oklch(0.6 0.2 ${h1}), oklch(0.4 0.1 ${h2}))`);
  });

  it("leaves values without --tug-color() untouched", () => {
    expect(processDecl("var(--something, rgba(0,0,0,0.5))")).toBe("var(--something, rgba(0,0,0,0.5))");
  });
});

describe("build errors", () => {
  it("rejects a non-adjacent pair", () => {
    expect(processDeclExpectError("--tug-color(blue-red, l: 30, c: 5)")).toContain("not adjacent");
  });

  it("rejects an unknown color", () => {
    expect(processDeclExpectError("--tug-color(notacolor, l: 30, c: 5)")).toContain("Unknown color");
  });

  it("rejects a chromatic hue missing l/c", () => {
    expect(processDeclExpectError("--tug-color(blue)")).toMatch(/lightness|chroma/);
  });
});
