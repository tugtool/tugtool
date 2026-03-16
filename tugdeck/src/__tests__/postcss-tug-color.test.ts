/**
 * Tests for the postcss-tug-color PostCSS plugin.
 *
 * Tests cover:
 * - Named hue expansion: --tug-color(blue, i: 5, t: 13) → oklch(0.3115 0.0143 230)
 * - Positional arguments: --tug-color(blue, 5, 13)
 * - Default arguments: --tug-color(blue) → intensity=50, tone=50
 * - Labeled arguments in any order
 * - Hyphenated adjacency: --tug-color(cobalt-indigo, i: 7, t: 37)
 * - Adjacency + preset: --tug-color(cobalt-indigo-intense)
 * - Non-adjacent pairs rejected: --tug-color(yellow-blue) errors at build
 * - Alpha: --tug-color(blue, i: 5, t: 13, a: 50)
 * - Multiple --tug-color() calls in a single declaration value
 * - Values without --tug-color() pass through unchanged
 * - var(), rgba(), and other CSS functions pass through unmodified
 */
import { describe, it, expect } from "bun:test";

import postcss from "postcss";
import postcssTugColor from "../../postcss-tug-color";
import {
  HUE_FAMILIES,
  DEFAULT_CANONICAL_L,
  MAX_CHROMA_FOR_HUE,
  PEAK_C_SCALE,
  L_DARK,
  L_LIGHT,
  findMaxChroma,
  tugColor,
  resolveHyphenatedHue,
  ADJACENCY_RING,
  ACHROMATIC_SEQUENCE,
  resolveAchromaticAdjacency,
} from "@/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run the postcss-tug-color plugin on a single CSS declaration and return the expanded value. */
function processDecl(prop: string, value: string): string {
  const css = `a { ${prop}: ${value}; }`;
  const result = postcss([postcssTugColor()]).process(css, { from: undefined });
  const root = result.root;
  let expanded = value;
  root.walkDecls(prop, (decl) => {
    expanded = decl.value;
  });
  return expanded;
}

/** Run the plugin and expect it to throw a CssSyntaxError; return the message. */
function processDeclExpectError(prop: string, value: string): string {
  const css = `a { ${prop}: ${value}; }`;
  try {
    postcss([postcssTugColor()]).process(css, { from: undefined }).css;
    throw new Error(`Expected a PostCSS error for '${value}', but it succeeded`);
  } catch (e: unknown) {
    if (e instanceof Error) {
      return e.message;
    }
    throw e;
  }
}

/** Parse an oklch() string into its numeric components. */
function parseOklch(s: string): { L: number; C: number; h: number; alpha?: number } | null {
  const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/);
  if (!m) return null;
  const result: { L: number; C: number; h: number; alpha?: number } = {
    L: parseFloat(m[1]),
    C: parseFloat(m[2]),
    h: parseFloat(m[3]),
  };
  if (m[4] !== undefined) result.alpha = parseFloat(m[4]);
  return result;
}

// ---------------------------------------------------------------------------
// Named hue expansion with labeled arguments
// ---------------------------------------------------------------------------

describe("postcss-tug-color: labeled argument expansion", () => {
  it("--tug-color(blue, i: 5, t: 13) expands to oklch(0.3115 0.0143 230)", () => {
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13)");
    expect(result).toBe("oklch(0.3115 0.0143 230)");
  });

  it("--tug-color(blue, i: 5, t: 13) matches tugColor() output exactly", () => {
    const expected = tugColor("blue", 5, 13, DEFAULT_CANONICAL_L["blue"]);
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13)");
    expect(result).toBe(expected);
  });

  it("labeled args in any order", () => {
    const result1 = processDecl("color", "--tug-color(c: blue, i: 5, t: 13)");
    const result2 = processDecl("color", "--tug-color(t: 13, c: blue, i: 5)");
    expect(result1).toBe(result2);
  });

  it("full label names work", () => {
    const result = processDecl("color", "--tug-color(color: blue, intensity: 5, tone: 13)");
    expect(result).toBe("oklch(0.3115 0.0143 230)");
  });
});

// ---------------------------------------------------------------------------
// Positional arguments
// ---------------------------------------------------------------------------

describe("postcss-tug-color: positional argument expansion", () => {
  it("--tug-color(blue, 5, 13) expands identically to labeled form", () => {
    const labeled = processDecl("color", "--tug-color(blue, i: 5, t: 13)");
    const positional = processDecl("color", "--tug-color(blue, 5, 13)");
    expect(positional).toBe(labeled);
  });

  it("all four positional: --tug-color(blue, 5, 13, 50)", () => {
    const result = processDecl("color", "--tug-color(blue, 5, 13, 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.alpha).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Default arguments
// ---------------------------------------------------------------------------

describe("postcss-tug-color: default arguments", () => {
  it("--tug-color(blue) uses i=50, t=50", () => {
    const result = processDecl("color", "--tug-color(blue)");
    const expected = tugColor("blue", 50, 50, DEFAULT_CANONICAL_L["blue"]);
    expect(result).toBe(expected);
  });

  it("--tug-color(blue, 20) uses t=50 default", () => {
    const result = processDecl("color", "--tug-color(blue, 20)");
    const expected = tugColor("blue", 20, 50, DEFAULT_CANONICAL_L["blue"]);
    expect(result).toBe(expected);
  });

  it("expands all 48 named hues at canonical (i=50, t=50)", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const expected = tugColor(hueName, 50, 50, canonL);
      const result = processDecl("color", `--tug-color(${hueName})`);
      expect(result).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Intensity and tone axis behavior
// ---------------------------------------------------------------------------

describe("postcss-tug-color: intensity and tone axes", () => {
  it("i=0 produces C=0 (achromatic)", () => {
    const result = processDecl("color", "--tug-color(red, i: 0, t: 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.C).toBe(0);
  });

  it("t=50 produces canonical L for each hue", () => {
    for (const hueName of Object.keys(HUE_FAMILIES)) {
      const canonL = DEFAULT_CANONICAL_L[hueName];
      const result = processDecl("color", `--tug-color(${hueName}, i: 50, t: 50)`);
      const parsed = parseOklch(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.L).toBeCloseTo(canonL, 3);
    }
  });

  it("t=0 produces L close to L_DARK (0.15)", () => {
    const result = processDecl("color", "--tug-color(blue, i: 50, t: 0)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(L_DARK, 3);
  });

  it("t=100 produces L close to L_LIGHT (0.96)", () => {
    const result = processDecl("color", "--tug-color(blue, i: 50, t: 100)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(L_LIGHT, 3);
  });

  it("i=100 produces C = MAX_CHROMA_FOR_HUE * PEAK_C_SCALE", () => {
    const result = processDecl("color", "--tug-color(red, i: 100, t: 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    const expectedC = MAX_CHROMA_FOR_HUE["red"] * PEAK_C_SCALE;
    expect(parsed!.C).toBeCloseTo(expectedC, 4);
  });
});

// ---------------------------------------------------------------------------
// Hyphenated adjacency syntax
// ---------------------------------------------------------------------------

describe("postcss-tug-color: hyphenated adjacency", () => {
  it("--tug-color(cobalt-indigo, i: 7, t: 37) resolves to correct OKLCH values", () => {
    const result = processDecl("color", "--tug-color(cobalt-indigo, i: 7, t: 37)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    // Verify hue angle matches resolveHyphenatedHue
    const expectedH = resolveHyphenatedHue("cobalt", "indigo");
    expect(parsed!.h).toBeCloseTo(expectedH, 4);
  });

  it("cobalt-indigo uses cobalt canonical L (dominant hue)", () => {
    const result = processDecl("color", "--tug-color(cobalt-indigo, i: 50, t: 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    const canonL = DEFAULT_CANONICAL_L["cobalt"];
    expect(parsed!.L).toBeCloseTo(canonL, 3);
  });

  it("cobalt-indigo peakC uses findMaxChroma at the resolved angle", () => {
    const result = processDecl("color", "--tug-color(cobalt-indigo, i: 100, t: 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    const h = resolveHyphenatedHue("cobalt", "indigo");
    const canonL = DEFAULT_CANONICAL_L["cobalt"];
    const expectedC = findMaxChroma(canonL, h) * PEAK_C_SCALE;
    expect(parsed!.C).toBeCloseTo(expectedC, 4);
  });

  it("cobalt-indigo-intense applies intense preset", () => {
    const withPreset = processDecl("color", "--tug-color(cobalt-indigo-intense)");
    const withExplicit = processDecl("color", "--tug-color(cobalt-indigo, i: 90, t: 50)");
    expect(withPreset).toBe(withExplicit);
  });

  it("cobalt-indigo-muted applies muted preset", () => {
    const withPreset = processDecl("color", "--tug-color(cobalt-indigo-muted)");
    const withExplicit = processDecl("color", "--tug-color(cobalt-indigo, i: 50, t: 42)");
    expect(withPreset).toBe(withExplicit);
  });

  it("adjacency result is different from either pure hue", () => {
    const cobalt = processDecl("color", "--tug-color(cobalt, i: 50, t: 50)");
    const indigo = processDecl("color", "--tug-color(indigo, i: 50, t: 50)");
    const blended = processDecl("color", "--tug-color(cobalt-indigo, i: 50, t: 50)");
    expect(blended).not.toBe(cobalt);
    expect(blended).not.toBe(indigo);
  });

  it("ring-wrap adjacency: berry-garnet resolves correctly", () => {
    const result = processDecl("color", "--tug-color(berry-garnet, i: 50, t: 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    const expectedH = resolveHyphenatedHue("berry", "garnet");
    expect(parsed!.h).toBeCloseTo(expectedH, 4);
  });
});

// ---------------------------------------------------------------------------
// Non-adjacent error tests
// ---------------------------------------------------------------------------

describe("postcss-tug-color: non-adjacent pair errors", () => {
  it("--tug-color(yellow-blue) throws a build error (not adjacent)", () => {
    const msg = processDeclExpectError("color", "--tug-color(yellow-blue)");
    expect(msg).toContain("postcss-tug-color");
    expect(msg).toContain("not adjacent");
  });

  it("--tug-color(red+5) throws a build error (offset syntax removed)", () => {
    const msg = processDeclExpectError("color", "--tug-color(red+5)");
    expect(msg).toContain("postcss-tug-color");
    expect(msg).toContain("+");
  });
});

// ---------------------------------------------------------------------------
// Alpha
// ---------------------------------------------------------------------------

describe("postcss-tug-color: alpha", () => {
  it("alpha 50 emits / 0.5", () => {
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13, a: 50)");
    expect(result).toContain("/ 0.5");
  });

  it("alpha 100 (default) emits no alpha suffix", () => {
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13)");
    expect(result).not.toContain("/");
  });

  it("alpha 0 emits / 0", () => {
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13, a: 0)");
    expect(result).toContain("/ 0");
  });

  it("fractional alpha: a: 33.333", () => {
    const result = processDecl("color", "--tug-color(blue, i: 5, t: 13, a: 33.333)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.alpha).toBeCloseTo(0.33333, 4);
  });
});

// ---------------------------------------------------------------------------
// Special colors: black and white
// ---------------------------------------------------------------------------

describe("postcss-tug-color: black and white", () => {
  it("--tug-color(black) → oklch(0 0 0)", () => {
    expect(processDecl("color", "--tug-color(black)")).toBe("oklch(0 0 0)");
  });

  it("--tug-color(white) → oklch(1 0 0)", () => {
    expect(processDecl("color", "--tug-color(white)")).toBe("oklch(1 0 0)");
  });

  it("--tug-color(black, a: 50) → oklch(0 0 0 / 0.5)", () => {
    expect(processDecl("color", "--tug-color(black, a: 50)")).toBe("oklch(0 0 0 / 0.5)");
  });

  it("--tug-color(white, a: 6) → oklch(1 0 0 / 0.06)", () => {
    expect(processDecl("color", "--tug-color(white, a: 6)")).toBe("oklch(1 0 0 / 0.06)");
  });
});

// ---------------------------------------------------------------------------
// Gray pseudo-hue (T-GRAY-TONE, T-GRAY-TONE-100, T-GRAY-INTENSITY-IGNORED, T-GRAY-ALPHA)
// ---------------------------------------------------------------------------

describe("postcss-tug-color: gray pseudo-hue", () => {
  it("T-GRAY-TONE: --tug-color(gray, t: 0) → oklch(0.15 0 0) (L_DARK)", () => {
    const result = processDecl("color", "--tug-color(gray, t: 0)");
    expect(result).toBe("oklch(0.15 0 0)");
  });

  it("--tug-color(gray) → oklch(0.5 0 0) (tone=50, canonical L=0.5)", () => {
    const result = processDecl("color", "--tug-color(gray)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(0.5, 4);
    expect(parsed!.C).toBe(0);
  });

  it("T-GRAY-TONE-100: --tug-color(gray, t: 100) → oklch(0.96 0 0) (L_LIGHT)", () => {
    const result = processDecl("color", "--tug-color(gray, t: 100)");
    expect(result).toBe("oklch(0.96 0 0)");
  });

  it("T-GRAY-INTENSITY-IGNORED: gray with i:80 and gray with i:20 produce identical output at same tone", () => {
    const with80 = processDecl("color", "--tug-color(gray, i: 80, t: 50)");
    const with20 = processDecl("color", "--tug-color(gray, i: 20, t: 50)");
    expect(with80).toBe(with20);
    const parsed = parseOklch(with80);
    expect(parsed).not.toBeNull();
    expect(parsed!.C).toBe(0);
  });

  it("T-GRAY-INTENSITY-IGNORED: --tug-color(gray, i: 80, t: 50) same as --tug-color(gray, t: 50)", () => {
    const withIntensity = processDecl("color", "--tug-color(gray, i: 80, t: 50)");
    const withoutIntensity = processDecl("color", "--tug-color(gray, t: 50)");
    expect(withIntensity).toBe(withoutIntensity);
  });

  it("T-GRAY-ALPHA: --tug-color(gray, t: 50, a: 50) produces alpha suffix", () => {
    const result = processDecl("color", "--tug-color(gray, t: 50, a: 50)");
    expect(result).toContain("/ 0.5");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.C).toBe(0);
    expect(parsed!.alpha).toBeCloseTo(0.5, 4);
  });

  it("gray C is always 0 regardless of tone", () => {
    for (const tone of [0, 10, 25, 50, 75, 90, 100]) {
      const result = processDecl("color", `--tug-color(gray, t: ${tone})`);
      const parsed = parseOklch(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.C).toBe(0);
    }
  });

  it("gray L follows the tone formula with canonical L=0.5", () => {
    const atTone50 = processDecl("color", "--tug-color(gray, t: 50)");
    const parsed = parseOklch(atTone50);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(0.5, 4);
  });
});

// ---------------------------------------------------------------------------
// Multiple --tug-color() calls in one declaration
// ---------------------------------------------------------------------------

describe("postcss-tug-color: multiple calls in one value", () => {
  it("two calls are both expanded", () => {
    const result = processDecl(
      "background",
      "linear-gradient(--tug-color(blue, i: 5, t: 13), --tug-color(red, i: 50, t: 50))",
    );
    expect(result).not.toContain("--tug-color(");
    expect(result).toContain("oklch(");
    const matches = result.match(/oklch\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("three calls are all expanded", () => {
    const result = processDecl(
      "background",
      "linear-gradient(--tug-color(blue, i: 5, t: 50), --tug-color(green), --tug-color(red, i: 50, t: 20))",
    );
    expect(result).not.toContain("--tug-color(");
    const matches = result.match(/oklch\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it("each expanded value matches tugColor() output", () => {
    const result = processDecl(
      "background",
      "linear-gradient(--tug-color(blue, i: 20, t: 85), --tug-color(red))",
    );
    const blueExpected = tugColor("blue", 20, 85, DEFAULT_CANONICAL_L["blue"]);
    const redExpected = tugColor("red", 50, 50, DEFAULT_CANONICAL_L["red"]);
    expect(result).toContain(blueExpected);
    expect(result).toContain(redExpected);
  });
});

// ---------------------------------------------------------------------------
// Pass-through: values without --tug-color() are unchanged
// ---------------------------------------------------------------------------

describe("postcss-tug-color: values without --tug-color() are unchanged", () => {
  it("plain hex value passes through unchanged", () => {
    expect(processDecl("color", "#3b82f6")).toBe("#3b82f6");
  });

  it("oklch() value passes through unchanged", () => {
    expect(processDecl("color", "oklch(0.5 0.1 230)")).toBe("oklch(0.5 0.1 230)");
  });

  it("named color passes through unchanged", () => {
    expect(processDecl("color", "transparent")).toBe("transparent");
  });

  it("var() reference passes through unchanged", () => {
    expect(processDecl("color", "var(--tug-blue)")).toBe("var(--tug-blue)");
  });

  it("linear-gradient() value passes through unchanged", () => {
    const value = "linear-gradient(to right, #3b82f6, white)";
    expect(processDecl("color", value)).toBe(value);
  });

  it("rgba() value passes through unchanged", () => {
    expect(processDecl("color", "rgba(0, 0, 0, 0.5)")).toBe("rgba(0, 0, 0, 0.5)");
  });
});

// ---------------------------------------------------------------------------
// CSS property variations
// ---------------------------------------------------------------------------

describe("postcss-tug-color: works on any CSS property", () => {
  it("expands --tug-color() in background-color", () => {
    const result = processDecl("background-color", "--tug-color(blue, i: 5, t: 13)");
    expect(result).toBe("oklch(0.3115 0.0143 230)");
  });

  it("expands --tug-color() in border-color", () => {
    const result = processDecl("border-color", "--tug-color(green, i: 20, t: 40)");
    expect(result).toMatch(/^oklch\(/);
    expect(result).not.toContain("--tug-color(");
  });

  it("expands --tug-color() in fill (SVG property)", () => {
    const result = processDecl("fill", "--tug-color(cherry)");
    expect(result).toMatch(/^oklch\(/);
    expect(result).not.toContain("--tug-color(");
  });
});

// ---------------------------------------------------------------------------
// ADJACENCY_RING coverage: all 48 adjacent pairs are accepted
// ---------------------------------------------------------------------------

describe("postcss-tug-color: all ring-adjacent pairs expand without error", () => {
  it("every adjacent pair in ADJACENCY_RING resolves to a valid oklch()", () => {
    for (let idx = 0; idx < ADJACENCY_RING.length; idx++) {
      const a = ADJACENCY_RING[idx];
      const b = ADJACENCY_RING[(idx + 1) % ADJACENCY_RING.length];
      const result = processDecl("color", `--tug-color(${a}-${b})`);
      expect(result).toMatch(/^oklch\(/);
      expect(result).not.toContain("--tug-color(");
    }
  });
});

// ---------------------------------------------------------------------------
// Named gray expansion (step 3)
// ---------------------------------------------------------------------------

describe("postcss-tug-color: named gray expansion", () => {
  it("--tug-color(paper) expands to oklch(0.22 0 0)", () => {
    const result = processDecl("color", "--tug-color(paper)");
    expect(result).toBe("oklch(0.22 0 0)");
  });

  it("--tug-color(pitch) expands to oklch(0.868 0 0)", () => {
    const result = processDecl("color", "--tug-color(pitch)");
    expect(result).toBe("oklch(0.868 0 0)");
  });

  it("--tug-color(graphite) expands to oklch(0.5 0 0)", () => {
    const result = processDecl("color", "--tug-color(graphite)");
    expect(result).toBe("oklch(0.5 0 0)");
  });

  it("named gray with t: 80 still expands to fixed L (tone is ignored per [D06])", () => {
    const withTone = processDecl("color", "--tug-color(paper, t: 80)");
    const without = processDecl("color", "--tug-color(paper)");
    expect(withTone).toBe(without);
    expect(withTone).toBe("oklch(0.22 0 0)");
  });

  it("named gray with i: 50 and t: 80 still expands to fixed L (both ignored)", () => {
    const result = processDecl("color", "--tug-color(paper, i: 50, t: 80)");
    expect(result).toBe("oklch(0.22 0 0)");
  });

  it("named gray with a: 50 honors alpha — oklch(0.22 0 0 / 0.5)", () => {
    const result = processDecl("color", "--tug-color(paper, a: 50)");
    expect(result).toBe("oklch(0.22 0 0 / 0.5)");
  });

  it("all 9 named grays expand to achromatic oklch() with C=0", () => {
    const namedGrays = ["paper", "linen", "parchment", "vellum", "graphite", "carbon", "charcoal", "ink", "pitch"];
    for (const name of namedGrays) {
      const result = processDecl("color", `--tug-color(${name})`);
      expect(result).toMatch(/^oklch\([\d.]+ 0 0\)$/);
    }
  });

  it("named gray L values match the expected fixed values from Table T01", () => {
    const expected: Record<string, number> = {
      paper: 0.22, linen: 0.29, parchment: 0.36, vellum: 0.43, graphite: 0.5,
      carbon: 0.592, charcoal: 0.684, ink: 0.776, pitch: 0.868,
    };
    for (const [name, l] of Object.entries(expected)) {
      const result = processDecl("color", `--tug-color(${name})`);
      const parsed = parseOklch(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.L).toBeCloseTo(l, 3);
    }
  });
});

// ---------------------------------------------------------------------------
// Transparent expansion (step 3)
// ---------------------------------------------------------------------------

describe("postcss-tug-color: transparent expansion", () => {
  it("--tug-color(transparent) expands to oklch(0 0 0 / 0)", () => {
    const result = processDecl("color", "--tug-color(transparent)");
    expect(result).toBe("oklch(0 0 0 / 0)");
  });

  it("--tug-color(transparent, a: 50) still expands to oklch(0 0 0 / 0) (alpha ignored)", () => {
    const result = processDecl("color", "--tug-color(transparent, a: 50)");
    expect(result).toBe("oklch(0 0 0 / 0)");
  });

  it("--tug-color(transparent, i: 50, t: 50) still expands to oklch(0 0 0 / 0)", () => {
    const result = processDecl("color", "--tug-color(transparent, i: 50, t: 50)");
    expect(result).toBe("oklch(0 0 0 / 0)");
  });
});

// ---------------------------------------------------------------------------
// Achromatic adjacency expansion (step 3)
// ---------------------------------------------------------------------------

describe("postcss-tug-color: achromatic adjacency expansion", () => {
  it("--tug-color(paper-linen) expands to approximately oklch(0.2433 0 0)", () => {
    const result = processDecl("color", "--tug-color(paper-linen)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(0.2433, 3);
    expect(parsed!.C).toBe(0);
    expect(parsed!.h).toBe(0);
  });

  it("--tug-color(linen-paper) expands to approximately oklch(0.2667 0 0)", () => {
    const result = processDecl("color", "--tug-color(linen-paper)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(0.2667, 3);
  });

  it("paper-linen and linen-paper produce different L values (asymmetric)", () => {
    const pl = processDecl("color", "--tug-color(paper-linen)");
    const lp = processDecl("color", "--tug-color(linen-paper)");
    expect(pl).not.toBe(lp);
    const parsedPL = parseOklch(pl)!;
    const parsedLP = parseOklch(lp)!;
    expect(parsedPL.L).toBeLessThan(parsedLP.L);
  });

  it("--tug-color(black-paper) expands with achromatic adjacency before black early return", () => {
    // L = (2/3)*0 + (1/3)*0.22 ≈ 0.0733
    const result = processDecl("color", "--tug-color(black-paper)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(0.0733, 3);
    expect(parsed!.C).toBe(0);
  });

  it("--tug-color(paper-black) expands correctly", () => {
    // L = (2/3)*0.22 + (1/3)*0 ≈ 0.1467
    const result = processDecl("color", "--tug-color(paper-black)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(0.1467, 3);
  });

  it("--tug-color(pitch-white) expands with achromatic adjacency before white early return", () => {
    // L = (2/3)*0.868 + (1/3)*1 ≈ 0.912
    const result = processDecl("color", "--tug-color(pitch-white)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(0.912, 3);
  });

  it("--tug-color(white-pitch) expands correctly", () => {
    // L = (2/3)*1 + (1/3)*0.868 ≈ 0.956
    const result = processDecl("color", "--tug-color(white-pitch)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(0.956, 3);
  });

  it("all consecutive pairs in ACHROMATIC_SEQUENCE resolve to valid oklch()", () => {
    for (let i = 0; i < ACHROMATIC_SEQUENCE.length - 1; i++) {
      const a = ACHROMATIC_SEQUENCE[i];
      const b = ACHROMATIC_SEQUENCE[i + 1];
      const result = processDecl("color", `--tug-color(${a}-${b})`);
      expect(result).toMatch(/^oklch\(/);
      const parsed = parseOklch(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.C).toBe(0);
    }
  });

  it("achromatic adjacency L values match resolveAchromaticAdjacency() exactly", () => {
    for (let i = 0; i < ACHROMATIC_SEQUENCE.length - 1; i++) {
      const a = ACHROMATIC_SEQUENCE[i];
      const b = ACHROMATIC_SEQUENCE[i + 1];
      const expected = resolveAchromaticAdjacency(a, b);
      const result = processDecl("color", `--tug-color(${a}-${b})`);
      const parsed = parseOklch(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.L).toBeCloseTo(expected, 4);
    }
  });

  it("--tug-color(paper-linen, a: 50) honors alpha with achromatic adjacency", () => {
    const result = processDecl("color", "--tug-color(paper-linen, a: 50)");
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.alpha).toBeCloseTo(0.5, 4);
    expect(parsed!.C).toBe(0);
  });

  it("--tug-color(paper-transparent) throws a build error (transparent not in achromatic sequence)", () => {
    const msg = processDeclExpectError("color", "--tug-color(paper-transparent)");
    expect(msg).toContain("postcss-tug-color");
    expect(msg).toContain("not adjacent");
  });

  it("--tug-color(paper-parchment) throws a build error (distance=2, not adjacent)", () => {
    const msg = processDeclExpectError("color", "--tug-color(paper-parchment)");
    expect(msg).toContain("postcss-tug-color");
    expect(msg).toContain("not adjacent");
  });

  it("--tug-color(paper-linen-dark) expands to same oklch as paper-linen and emits a console.warn about the preset", () => {
    const warnMessages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnMessages.push(String(args[0])); };
    try {
      const result = processDecl("color", "--tug-color(paper-linen-dark)");
      const expected = processDecl("color", "--tug-color(paper-linen)");
      expect(result).toBe(expected);
      expect(warnMessages.some((m) => m.includes("preset") && m.includes("dark") && m.includes("paper-linen"))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });
});
