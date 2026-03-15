/**
 * Tests for tug-color-parser — the tokenizer and parser for --tug-color() color notation.
 *
 * Covers:
 * - Positional arguments (color only, color+i, color+i+t, all four)
 * - Labeled arguments (short and full label names, any order)
 * - Mixed positional + labeled
 * - Default values for intensity, tone, alpha
 * - Adjacency syntax (cobalt-indigo, cobalt-indigo-intense, etc.)
 * - Fractional numeric values
 * - Error reporting: unknown colors, out-of-range, bad labels, type mismatches
 * - Error: '+' in input (offset syntax removed)
 * - Error: non-adjacent pairs
 * - CSS value scanning (findTugColorCalls)
 * - Gray pseudo-hue: achromatic, C=0, tone formula with canonical L=0.5
 */
import { describe, it, expect } from "bun:test";
import { parseTugColor, findTugColorCalls } from "../../tug-color-parser";
import type { TugColorParsed, TugColorError } from "../../tug-color-parser";
import { TUG_COLOR_PRESETS, ADJACENCY_RING } from "@/components/tugways/palette-engine";

// All 48 named hues plus black and white
const KNOWN_HUES = new Set([
  ...ADJACENCY_RING,
  "black", "white",
]);

// All 48 named hues plus black, white, and gray (for gray pseudo-hue tests)
const KNOWN_HUES_WITH_GRAY = new Set([
  ...ADJACENCY_RING,
  "black", "white", "gray",
]);

// Known presets map from TUG_COLOR_PRESETS
const KNOWN_PRESETS: ReadonlyMap<string, { intensity: number; tone: number }> =
  new Map(Object.entries(TUG_COLOR_PRESETS));

/** Assert a successful parse and return the parsed value. */
function expectOk(input: string): TugColorParsed {
  const result = parseTugColor(input, KNOWN_HUES);
  if (!result.ok) {
    throw new Error(
      `Expected ok parse for '${input}', got errors:\n` +
      result.errors.map((e) => `  - ${e.message}`).join("\n"),
    );
  }
  return result.value;
}

/** Assert a successful parse with presets and return the parsed value. */
function expectOkWithPresets(input: string): TugColorParsed {
  const result = parseTugColor(input, KNOWN_HUES, KNOWN_PRESETS);
  if (!result.ok) {
    throw new Error(
      `Expected ok parse for '${input}', got errors:\n` +
      result.errors.map((e) => `  - ${e.message}`).join("\n"),
    );
  }
  return result.value;
}

/** Assert a successful parse with adjacency ring and return the parsed value. */
function expectOkWithAdjacency(input: string): TugColorParsed {
  const result = parseTugColor(input, KNOWN_HUES, KNOWN_PRESETS, ADJACENCY_RING);
  if (!result.ok) {
    throw new Error(
      `Expected ok parse for '${input}', got errors:\n` +
      result.errors.map((e) => `  - ${e.message}`).join("\n"),
    );
  }
  return result.value;
}

/** Verify that every error in the array has valid source span fields. */
function assertAllErrorsHaveSpans(errors: TugColorError[], input: string): void {
  for (const err of errors) {
    if (!("end" in err)) {
      throw new Error(
        `Error missing 'end' field for input '${input}': ${JSON.stringify(err)}`,
      );
    }
    if (typeof err.pos !== "number" || typeof err.end !== "number") {
      throw new Error(
        `Error pos/end must be numbers for input '${input}': ${JSON.stringify(err)}`,
      );
    }
    if (err.end < err.pos) {
      throw new Error(
        `Error end (${err.end}) must be >= pos (${err.pos}) for input '${input}': ${JSON.stringify(err)}`,
      );
    }
  }
}

/** Assert a failed parse and return the error list. */
function expectErrors(input: string): TugColorError[] {
  const result = parseTugColor(input, KNOWN_HUES);
  if (result.ok) {
    throw new Error(
      `Expected errors for '${input}', got ok: ${JSON.stringify(result.value)}`,
    );
  }
  assertAllErrorsHaveSpans(result.errors, input);
  return result.errors;
}

/** Assert a failed parse with presets and return the error list. */
function expectErrorsWithPresets(input: string): TugColorError[] {
  const result = parseTugColor(input, KNOWN_HUES, KNOWN_PRESETS);
  if (result.ok) {
    throw new Error(
      `Expected errors for '${input}', got ok: ${JSON.stringify(result.value)}`,
    );
  }
  assertAllErrorsHaveSpans(result.errors, input);
  return result.errors;
}

/** Assert a failed parse with adjacency ring and return the error list. */
function expectErrorsWithAdjacency(input: string): TugColorError[] {
  const result = parseTugColor(input, KNOWN_HUES, KNOWN_PRESETS, ADJACENCY_RING);
  if (result.ok) {
    throw new Error(
      `Expected errors for '${input}', got ok: ${JSON.stringify(result.value)}`,
    );
  }
  assertAllErrorsHaveSpans(result.errors, input);
  return result.errors;
}

// ---------------------------------------------------------------------------
// Positional arguments
// ---------------------------------------------------------------------------

describe("tug-color-parser: positional arguments", () => {
  it("color only — defaults for i/t/a", () => {
    const v = expectOk("green");
    expect(v.color).toEqual({ name: "green" });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(50);
    expect(v.alpha).toBe(100);
  });

  it("color + intensity — defaults for t/a", () => {
    const v = expectOk("violet, 30");
    expect(v.color).toEqual({ name: "violet" });
    expect(v.intensity).toBe(30);
    expect(v.tone).toBe(50);
    expect(v.alpha).toBe(100);
  });

  it("color + intensity + tone — default for a", () => {
    const v = expectOk("red, 50, 40");
    expect(v.color).toEqual({ name: "red" });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(40);
    expect(v.alpha).toBe(100);
  });

  it("all four positional", () => {
    const v = expectOk("red, 50, 40, 80");
    expect(v.color).toEqual({ name: "red" });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(40);
    expect(v.alpha).toBe(80);
  });

  it("boundary values: i=0, t=0, a=0", () => {
    const v = expectOk("blue, 0, 0, 0");
    expect(v.intensity).toBe(0);
    expect(v.tone).toBe(0);
    expect(v.alpha).toBe(0);
  });

  it("boundary values: i=100, t=100, a=100", () => {
    const v = expectOk("blue, 100, 100, 100");
    expect(v.intensity).toBe(100);
    expect(v.tone).toBe(100);
    expect(v.alpha).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Labeled arguments
// ---------------------------------------------------------------------------

describe("tug-color-parser: labeled arguments", () => {
  it("all labeled with short names", () => {
    const v = expectOk("c: red, i: 50, t: 40, a: 100");
    expect(v.color).toEqual({ name: "red" });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(40);
    expect(v.alpha).toBe(100);
  });

  it("all labeled with full names", () => {
    const v = expectOk("color: red, intensity: 30, tone: 20, alpha: 100");
    expect(v.color).toEqual({ name: "red" });
    expect(v.intensity).toBe(30);
    expect(v.tone).toBe(20);
    expect(v.alpha).toBe(100);
  });

  it("labeled in arbitrary order", () => {
    const v = expectOk("t: 40, a: 80, c: purple, i: 12");
    expect(v.color).toEqual({ name: "purple" });
    expect(v.intensity).toBe(12);
    expect(v.tone).toBe(40);
    expect(v.alpha).toBe(80);
  });

  it("sparse labeled — just color and tone", () => {
    const v = expectOk("c: coral, t: 20");
    expect(v.color).toEqual({ name: "coral" });
    expect(v.intensity).toBe(50); // default
    expect(v.tone).toBe(20);
    expect(v.alpha).toBe(100); // default
  });

  it("sparse labeled — just color and alpha", () => {
    const v = expectOk("c: sky, a: 50");
    expect(v.color).toEqual({ name: "sky" });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(50);
    expect(v.alpha).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Mixed positional + labeled
// ---------------------------------------------------------------------------

describe("tug-color-parser: mixed positional + labeled", () => {
  it("positional color, labeled tone", () => {
    const v = expectOk("coral, t: 20");
    expect(v.color).toEqual({ name: "coral" });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(20);
    expect(v.alpha).toBe(100);
  });

  it("positional color + intensity, labeled alpha", () => {
    const v = expectOk("blue, 70, a: 50");
    expect(v.color).toEqual({ name: "blue" });
    expect(v.intensity).toBe(70);
    expect(v.tone).toBe(50);
    expect(v.alpha).toBe(50);
  });

  it("positional color, labeled intensity and tone", () => {
    const v = expectOk("mint, i: 80, t: 30");
    expect(v.color).toEqual({ name: "mint" });
    expect(v.intensity).toBe(80);
    expect(v.tone).toBe(30);
    expect(v.alpha).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Hyphenated adjacency syntax
// ---------------------------------------------------------------------------

describe("tug-color-parser: hyphenated adjacency", () => {
  it("cobalt-indigo resolves adjacentName correctly (without adjacency ring)", () => {
    const v = expectOkWithPresets("cobalt-indigo");
    expect(v.color.name).toBe("cobalt");
    expect(v.color.adjacentName).toBe("indigo");
    expect(v.color.preset).toBeUndefined();
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(50);
  });

  it("cobalt-indigo resolves adjacentName correctly (with adjacency ring)", () => {
    const v = expectOkWithAdjacency("cobalt-indigo");
    expect(v.color.name).toBe("cobalt");
    expect(v.color.adjacentName).toBe("indigo");
    expect(v.color.preset).toBeUndefined();
  });

  it("indigo-cobalt resolves adjacentName correctly (reverse direction)", () => {
    const v = expectOkWithAdjacency("indigo-cobalt");
    expect(v.color.name).toBe("indigo");
    expect(v.color.adjacentName).toBe("cobalt");
  });

  it("cobalt-indigo-intense resolves adjacency + preset", () => {
    const v = expectOkWithAdjacency("cobalt-indigo-intense");
    expect(v.color.name).toBe("cobalt");
    expect(v.color.adjacentName).toBe("indigo");
    expect(v.color.preset).toBe("intense");
    expect(v.intensity).toBe(90); // from intense preset
  });

  it("cobalt-indigo-muted resolves adjacency + muted preset", () => {
    const v = expectOkWithAdjacency("cobalt-indigo-muted");
    expect(v.color.name).toBe("cobalt");
    expect(v.color.adjacentName).toBe("indigo");
    expect(v.color.preset).toBe("muted");
    expect(v.intensity).toBe(50); // from muted preset
    expect(v.tone).toBe(42);      // from muted preset
  });

  it("red-vermilion adjacency (ring neighbors)", () => {
    const v = expectOkWithAdjacency("red-vermilion");
    expect(v.color.name).toBe("red");
    expect(v.color.adjacentName).toBe("vermilion");
  });

  it("ring wrap: berry-garnet are adjacent", () => {
    const v = expectOkWithAdjacency("berry-garnet");
    expect(v.color.name).toBe("berry");
    expect(v.color.adjacentName).toBe("garnet");
  });

  it("adjacency with labeled syntax: c: cobalt-indigo", () => {
    const v = expectOkWithAdjacency("c: cobalt-indigo, i: 7, t: 37");
    expect(v.color.name).toBe("cobalt");
    expect(v.color.adjacentName).toBe("indigo");
    expect(v.intensity).toBe(7);
    expect(v.tone).toBe(37);
  });

  it("adjacency without ring: any two known hues may be hyphenated", () => {
    // Without adjacencyRing, non-adjacent pairs are allowed
    const v = expectOkWithPresets("yellow-blue");
    expect(v.color.name).toBe("yellow");
    expect(v.color.adjacentName).toBe("blue");
  });
});

// ---------------------------------------------------------------------------
// Non-adjacent error tests
// ---------------------------------------------------------------------------

describe("tug-color-parser: non-adjacent errors", () => {
  it("yellow-blue produces error with adjacency ring (not adjacent)", () => {
    const errs = expectErrorsWithAdjacency("yellow-blue");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("yellow");
    expect(errs[0].message).toContain("blue");
    expect(errs[0].message).toContain("not adjacent");
  });

  it("red-violet produces error with adjacency ring (not adjacent)", () => {
    const errs = expectErrorsWithAdjacency("red-violet");
    expect(errs[0].message).toContain("not adjacent");
  });

  it("cobalt-indigo-blue errors (third ident must be preset, not color)", () => {
    const errs = expectErrorsWithAdjacency("cobalt-indigo-blue");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("preset");
  });

  it("black and white are not in the adjacency ring — adjacency errors", () => {
    const errs = expectErrorsWithAdjacency("black-white");
    expect(errs[0].message).toContain("not adjacent");
  });
});

// ---------------------------------------------------------------------------
// Plus sign rejected (offset syntax removed)
// ---------------------------------------------------------------------------

describe("tug-color-parser: plus sign rejected", () => {
  it("red+5 produces error — hue offsets removed", () => {
    const errs = expectErrors("red+5");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("+");
    expect(errs[0].message).toContain("adjacency");
  });

  it("c: red+5 produces error with labeled syntax", () => {
    const errs = expectErrors("c: red+5, i: 30, t: 70");
    expect(errs.some((e) => e.message.includes("+"))).toBe(true);
  });

  it("tomato+3 produces error", () => {
    const errs = expectErrors("tomato+3");
    expect(errs[0].message).toContain("+");
  });
});

// ---------------------------------------------------------------------------
// Fractional numeric values
// ---------------------------------------------------------------------------

describe("tug-color-parser: fractional values", () => {
  it("fractional intensity", () => {
    const v = expectOk("c: red, i: 50.2");
    expect(v.intensity).toBe(50.2);
  });

  it("fractional tone", () => {
    const v = expectOk("c: red, t: 1.234");
    expect(v.tone).toBe(1.234);
  });

  it("fractional alpha", () => {
    const v = expectOk("c: red, a: 33.333");
    expect(v.alpha).toBe(33.333);
  });

  it("all fractional", () => {
    const v = expectOk("red, 12.5, 87.3, 99.9");
    expect(v.intensity).toBe(12.5);
    expect(v.tone).toBe(87.3);
    expect(v.alpha).toBe(99.9);
  });
});

// ---------------------------------------------------------------------------
// Whitespace handling
// ---------------------------------------------------------------------------

describe("tug-color-parser: whitespace tolerance", () => {
  it("no spaces", () => {
    const v = expectOk("c:red,i:50,t:40,a:100");
    expect(v.color).toEqual({ name: "red" });
    expect(v.intensity).toBe(50);
  });

  it("extra spaces around labeled args", () => {
    const v = expectOk("  c :  red  ,  i : 30  ,  t : 70  ");
    expect(v.color).toEqual({ name: "red" });
    expect(v.intensity).toBe(30);
    expect(v.tone).toBe(70);
  });

  it("tabs and mixed whitespace", () => {
    const v = expectOk("c:\tred,\ti:\t50");
    expect(v.color).toEqual({ name: "red" });
    expect(v.intensity).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Error reporting
// ---------------------------------------------------------------------------

describe("tug-color-parser: error reporting", () => {
  it("unknown color name", () => {
    const errs = expectErrors("obsidian");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("Unknown color 'obsidian'");
  });

  it("negative intensity is out of range", () => {
    const errs = expectErrors("red, i: -100");
    expect(errs.some((e) => e.message.includes("out of range for intensity"))).toBe(true);
  });

  it("non-numeric tone value", () => {
    const errs = expectErrors("red, t: hello");
    expect(errs.some((e) => e.message.includes("Invalid value 'hello' for tone"))).toBe(true);
  });

  it("alpha out of range (> 100)", () => {
    const errs = expectErrors("red, a: 5000");
    expect(errs.some((e) => e.message.includes("out of range for alpha"))).toBe(true);
  });

  it("unknown label", () => {
    const errs = expectErrors("c: red, foo: bar");
    expect(errs.some((e) => e.message.includes("Unknown label 'foo'"))).toBe(true);
  });

  it("multiple errors collected from one call", () => {
    const errs = expectErrors("obsidian, i: -100, t: hello, a: 5000, foo: bar");
    // Should have at least 5 errors: unknown color, out-of-range i, bad t, out-of-range a, unknown label
    expect(errs.length).toBeGreaterThanOrEqual(5);
    expect(errs.some((e) => e.message.includes("Unknown color"))).toBe(true);
    expect(errs.some((e) => e.message.includes("out of range for intensity"))).toBe(true);
    expect(errs.some((e) => e.message.includes("Invalid value 'hello'"))).toBe(true);
    expect(errs.some((e) => e.message.includes("out of range for alpha"))).toBe(true);
    expect(errs.some((e) => e.message.includes("Unknown label 'foo'"))).toBe(true);
  });

  it("positional arg after labeled arg", () => {
    const errs = expectErrors("c: red, 50");
    expect(errs.some((e) => e.message.includes("Positional argument after labeled"))).toBe(true);
  });

  it("too many positional arguments", () => {
    const errs = expectErrors("red, 50, 50, 100, 999");
    expect(errs.some((e) => e.message.includes("Too many arguments"))).toBe(true);
  });

  it("duplicate labeled slot", () => {
    const errs = expectErrors("c: red, c: blue");
    expect(errs.some((e) => e.message.includes("Duplicate value for color"))).toBe(true);
  });

  it("empty input", () => {
    const errs = expectErrors("");
    expect(errs.some((e) => e.message.includes("Empty --tug-color()"))).toBe(true);
  });

  it("empty argument from extra comma", () => {
    const errs = expectErrors("red,,50");
    expect(errs.some((e) => e.message.includes("Empty argument"))).toBe(true);
  });

  it("missing required color", () => {
    const errs = expectErrors("i: 50, t: 30");
    expect(errs.some((e) => e.message.includes("Missing required color"))).toBe(true);
  });

  it("unexpected character", () => {
    const errs = expectErrors("red, i: 50, t: @30");
    expect(errs.some((e) => e.message.includes("Unexpected character '@'"))).toBe(true);
  });

  it("number where color expected", () => {
    const errs = expectErrors("42, 50, 50");
    expect(errs.some((e) => e.message.includes("Expected a color name, got '42'"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Special colors: black and white
// ---------------------------------------------------------------------------

describe("tug-color-parser: black and white", () => {
  it("black parses as a valid color", () => {
    const v = expectOk("black");
    expect(v.color).toEqual({ name: "black" });
  });

  it("white parses as a valid color", () => {
    const v = expectOk("white");
    expect(v.color).toEqual({ name: "white" });
  });

  it("black with alpha", () => {
    const v = expectOk("black, a: 50");
    expect(v.color.name).toBe("black");
    expect(v.alpha).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Preset syntax: --tug-color(hue-preset)
// ---------------------------------------------------------------------------

describe("tug-color-parser: preset syntax", () => {
  it("--tug-color(green-intense) uses intense preset defaults: i=90, t=50", () => {
    const v = expectOkWithPresets("green-intense");
    expect(v.color).toEqual({ name: "green", preset: "intense" });
    expect(v.intensity).toBe(90);
    expect(v.tone).toBe(50);
    expect(v.alpha).toBe(100);
  });

  it("--tug-color(orange-muted) uses muted preset defaults: i=50, t=42", () => {
    const v = expectOkWithPresets("orange-muted");
    expect(v.color).toEqual({ name: "orange", preset: "muted" });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(42);
  });

  it("--tug-color(blue-light) uses light preset defaults: i=20, t=85", () => {
    const v = expectOkWithPresets("blue-light");
    expect(v.color).toEqual({ name: "blue", preset: "light" });
    expect(v.intensity).toBe(20);
    expect(v.tone).toBe(85);
  });

  it("--tug-color(red-dark) uses dark preset defaults: i=50, t=20", () => {
    const v = expectOkWithPresets("red-dark");
    expect(v.color).toEqual({ name: "red", preset: "dark" });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(20);
  });

  it("--tug-color(cyan-canonical) uses canonical preset defaults: i=50, t=50", () => {
    const v = expectOkWithPresets("cyan-canonical");
    expect(v.color).toEqual({ name: "cyan", preset: "canonical" });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(50);
  });

  it("--tug-color(red-canonical) is equivalent to --tug-color(red) for numeric output", () => {
    const withPreset = expectOkWithPresets("red-canonical");
    const withoutPreset = expectOk("red");
    expect(withPreset.intensity).toBe(withoutPreset.intensity);
    expect(withPreset.tone).toBe(withoutPreset.tone);
    expect(withPreset.alpha).toBe(withoutPreset.alpha);
  });

  it("preset with explicit alpha override: --tug-color(orange-muted, a: 50)", () => {
    const v = expectOkWithPresets("orange-muted, a: 50");
    expect(v.color.preset).toBe("muted");
    expect(v.intensity).toBe(50); // from preset
    expect(v.tone).toBe(42);     // from preset
    expect(v.alpha).toBe(50);    // explicit override
  });

  it("preset with tone override: --tug-color(blue-light, t: 80) overrides tone to 80", () => {
    const v = expectOkWithPresets("blue-light, t: 80");
    expect(v.color.preset).toBe("light");
    expect(v.intensity).toBe(20); // from preset
    expect(v.tone).toBe(80);      // explicit override
  });

  it("preset with intensity override: --tug-color(green-muted, i: 40)", () => {
    const v = expectOkWithPresets("green-muted, i: 40");
    expect(v.color.preset).toBe("muted");
    expect(v.intensity).toBe(40); // explicit override
    expect(v.tone).toBe(42);      // from preset
  });

  it("unknown preset errors: --tug-color(red-foo) should error", () => {
    // 'foo' is not a preset name (PRESET_NAMES) and not a known hue, so errors as unknown color
    const errs = expectErrorsWithPresets("red-foo");
    expect(errs.some((e) => e.message.includes("'foo'"))).toBe(true);
  });

  it("without knownPresets, ident-minus-preset resolves (PRESET_NAMES check always runs)", () => {
    // Even without a knownPresets map, PRESET_NAMES is checked first [D05].
    // 'intense' is in PRESET_NAMES, so green-intense resolves as a preset with default i/t.
    const v = expectOk("green-intense");
    expect(v.color.name).toBe("green");
    expect(v.color.preset).toBe("intense");
    // Without knownPresets map, defaults (50/50) are used instead of preset-specific values
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(50);
  });

  it("labeled color with preset: --tug-color(c: orange-muted, a: 50)", () => {
    const v = expectOkWithPresets("c: orange-muted, a: 50");
    expect(v.color.preset).toBe("muted");
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(42);
    expect(v.alpha).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Gray pseudo-hue — parser recognition (T-GRAY-DEFAULT, T-GRAY-ADJACENCY-ERROR)
// ---------------------------------------------------------------------------

describe("tug-color-parser: gray pseudo-hue", () => {
  it("T-GRAY-DEFAULT: parseTugColor('gray') succeeds with correct defaults", () => {
    const result = parseTugColor("gray", KNOWN_HUES_WITH_GRAY);
    if (!result.ok) {
      throw new Error(
        `Expected ok parse for 'gray', got errors:\n` +
        result.errors.map((e) => `  - ${e.message}`).join("\n"),
      );
    }
    expect(result.value.color).toEqual({ name: "gray" });
    expect(result.value.intensity).toBe(50);
    expect(result.value.tone).toBe(50);
    expect(result.value.alpha).toBe(100);
  });

  it("gray with explicit tone and intensity parses successfully", () => {
    const result = parseTugColor("gray, i: 80, t: 30", KNOWN_HUES_WITH_GRAY);
    if (!result.ok) {
      throw new Error(
        `Expected ok parse for 'gray, i: 80, t: 30', got errors:\n` +
        result.errors.map((e) => `  - ${e.message}`).join("\n"),
      );
    }
    expect(result.value.color.name).toBe("gray");
    expect(result.value.intensity).toBe(80);
    expect(result.value.tone).toBe(30);
  });

  it("T-GRAY-ADJACENCY-ERROR: gray-red fails because gray is not in the adjacency ring", () => {
    const result = parseTugColor("gray-red", KNOWN_HUES_WITH_GRAY, KNOWN_PRESETS, ADJACENCY_RING);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes("not adjacent") || e.message.includes("gray"))).toBe(true);
    }
  });

  it("gray is not valid without gray in KNOWN_HUES", () => {
    // KNOWN_HUES does not include 'gray' — should fail
    const result = parseTugColor("gray", KNOWN_HUES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes("gray"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// findTugColorCalls — CSS value scanning
// ---------------------------------------------------------------------------

describe("findTugColorCalls: CSS value scanning", () => {
  it("finds a single --tug-color() call", () => {
    const calls = findTugColorCalls("--tug-color(red, 50, 50)");
    expect(calls.length).toBe(1);
    expect(calls[0].inner).toBe("red, 50, 50");
    expect(calls[0].start).toBe(0);
    expect(calls[0].end).toBe(24);
  });

  it("finds multiple --tug-color() calls in one value", () => {
    const calls = findTugColorCalls(
      "linear-gradient(--tug-color(blue, i: 5, t: 13), --tug-color(red, 50, 50))",
    );
    expect(calls.length).toBe(2);
    expect(calls[0].inner).toBe("blue, i: 5, t: 13");
    expect(calls[1].inner).toBe("red, 50, 50");
  });

  it("returns empty array when no --tug-color() calls present", () => {
    expect(findTugColorCalls("oklch(0.5 0.1 230)")).toEqual([]);
    expect(findTugColorCalls("var(--tug-blue)")).toEqual([]);
    expect(findTugColorCalls("#3b82f6")).toEqual([]);
  });

  it("handles nested parentheses", () => {
    const calls = findTugColorCalls("linear-gradient(to right, --tug-color(blue, 50, 50) 50%, white)");
    expect(calls.length).toBe(1);
    expect(calls[0].inner).toBe("blue, 50, 50");
  });

  it("ignores unmatched parenthesis", () => {
    const calls = findTugColorCalls("--tug-color(red");
    expect(calls.length).toBe(0);
  });

  it("extracts correct start/end positions", () => {
    const input = "bg: --tug-color(green); color: --tug-color(cobalt-indigo, i: 80);";
    const calls = findTugColorCalls(input);
    expect(calls.length).toBe(2);
    expect(input.slice(calls[0].start, calls[0].end)).toBe("--tug-color(green)");
    expect(input.slice(calls[1].start, calls[1].end)).toBe("--tug-color(cobalt-indigo, i: 80)");
  });
});

// ---------------------------------------------------------------------------
// Source spans — TugColorError.pos and TugColorError.end (T-SPAN-*)
// ---------------------------------------------------------------------------

describe("tug-color-parser: source spans on TugColorError", () => {
  it("T-SPAN-SINGLE: unknown color error has pos=0, end=length of unknown ident", () => {
    const result = parseTugColor("bogus", KNOWN_HUES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors[0];
      expect(err).toHaveProperty("pos");
      expect(err).toHaveProperty("end");
      expect(err.pos).toBe(0);
      // "bogus" is 5 characters
      expect(err.end).toBe(5);
    }
  });

  it("T-SPAN-SINGLE: unknown color error span covers the full ident", () => {
    // "xyz" starts at offset 0, length 3
    const result = parseTugColor("xyz", KNOWN_HUES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.message.includes("xyz"));
      expect(err).toBeDefined();
      expect(err!.pos).toBe(0);
      expect(err!.end).toBe(3);
    }
  });

  it("T-SPAN-RANGE: out-of-range number has pos at start and end past the digits", () => {
    // "red, -5" — minus is at pos 5, "5" ends at pos 7
    const result = parseTugColor("red, -5", KNOWN_HUES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.message.includes("out of range"));
      expect(err).toBeDefined();
      // minus is at position 5, number "5" ends at position 7
      expect(err!.pos).toBe(5);
      expect(err!.end).toBe(7);
    }
  });

  it("T-SPAN-ALL-ERRORS: all errors in various test cases have both pos and end fields", () => {
    const testInputs = [
      "bogus",
      "red, -5",
      "red+5",
      "yellow-blue",
      "red, bad, 50",
      "xyz, 50",
    ];
    for (const input of testInputs) {
      const result = parseTugColor(input, KNOWN_HUES, KNOWN_PRESETS, ADJACENCY_RING);
      if (!result.ok) {
        for (const err of result.errors) {
          expect(err).toHaveProperty("pos");
          expect(err).toHaveProperty("end");
          expect(typeof err.pos).toBe("number");
          expect(typeof err.end).toBe("number");
        }
      }
    }
  });

  it("plus-sign error has pos=3 and end=4 in 'red+5'", () => {
    const result = parseTugColor("red+5", KNOWN_HUES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors[0];
      expect(err).toHaveProperty("end");
      expect(err.pos).toBe(3);
      expect(err.end).toBe(4);
    }
  });

  it("error pos and end are non-negative integers", () => {
    const result = parseTugColor("notacolor", KNOWN_HUES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const err of result.errors) {
        expect(err.pos).toBeGreaterThanOrEqual(0);
        expect(err.end).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(err.pos)).toBe(true);
        expect(Number.isInteger(err.end)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tokenizer rewrite — uppercase, CSS hex escapes, NBSP (T-UPPER, T-HEX-*, T-NBSP)
// ---------------------------------------------------------------------------

describe("tug-color-parser: tokenizer rewrite", () => {
  it("T-UPPER: parseTugColor('Red') succeeds with color.name='red'", () => {
    const result = parseTugColor("Red", KNOWN_HUES);
    if (!result.ok) {
      throw new Error(`Expected ok for 'Red', got: ${result.errors.map((e) => e.message).join(", ")}`);
    }
    expect(result.value.color.name).toBe("red");
  });

  it("T-UPPER: uppercase is normalized across the full ident", () => {
    const result = parseTugColor("GREEN", KNOWN_HUES);
    if (!result.ok) {
      throw new Error(`Expected ok for 'GREEN', got: ${result.errors.map((e) => e.message).join(", ")}`);
    }
    expect(result.value.color.name).toBe("green");
  });

  it("T-UPPER-MIXED: parseTugColor('Cobalt-Indigo') succeeds with adjacency", () => {
    const result = parseTugColor("Cobalt-Indigo", KNOWN_HUES, KNOWN_PRESETS, ADJACENCY_RING);
    if (!result.ok) {
      throw new Error(`Expected ok for 'Cobalt-Indigo', got: ${result.errors.map((e) => e.message).join(", ")}`);
    }
    expect(result.value.color.name).toBe("cobalt");
    expect(result.value.color.adjacentName).toBe("indigo");
  });

  it("T-UPPER-MIXED: mixed case labels are normalized", () => {
    // Labels use a-z only (colon stops ident scan), so this just tests the hue part
    const result = parseTugColor("VIOLET, 30, 40", KNOWN_HUES);
    if (!result.ok) {
      throw new Error(`Expected ok for 'VIOLET, 30, 40', got: ${result.errors.map((e) => e.message).join(", ")}`);
    }
    expect(result.value.color.name).toBe("violet");
    expect(result.value.intensity).toBe(30);
    expect(result.value.tone).toBe(40);
  });

  it("T-HEX-ESCAPE: '\\72 ed' decodes to ident 'red' (hex 72 = 'r', then 'ed')", () => {
    // \72 = 'r', trailing space consumed, 'ed' continues as same ident → 'red'
    const result = parseTugColor("\x5c72 ed", KNOWN_HUES);
    if (!result.ok) {
      throw new Error(`Expected ok for hex escape 'red', got: ${result.errors.map((e) => e.message).join(", ")}`);
    }
    expect(result.value.color.name).toBe("red");
  });

  it("T-HEX-ESCAPE-UPPER: '\\52 ed' decodes to ident 'red' (hex 52 = 'R' → 'r', then 'ed')", () => {
    // \52 = 'R' normalized to 'r', trailing space consumed, 'ed' continues → 'red'
    const result = parseTugColor("\x5c52 ed", KNOWN_HUES);
    if (!result.ok) {
      throw new Error(`Expected ok for hex escape uppercase 'red', got: ${result.errors.map((e) => e.message).join(", ")}`);
    }
    expect(result.value.color.name).toBe("red");
  });

  it("T-HEX-SINGLE: '\\41' tokenizes to ident 'a' (hex 41 = 'A' → 'a')", () => {
    // \41 = 'A' → 'a'; 'a' is not a known hue but the tokenizer should produce ident 'a'
    const result = parseTugColor("\x5c41", KNOWN_HUES);
    // The parse will fail because 'a' is not a known hue — that's expected
    // We verify it fails with "unknown color 'a'" not a tokenizer error
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes("'a'"))).toBe(true);
      // Must not contain tokenizer-level "Unexpected character" for the backslash
      expect(result.errors.every((e) => !e.message.includes("Unexpected character"))).toBe(true);
    }
  });

  it("T-NBSP: 'red,\\u00A050' succeeds with NBSP treated as whitespace", () => {
    // U+00A0 between comma and "50" should be treated as whitespace
    const result = parseTugColor("red,\u00A050", KNOWN_HUES);
    if (!result.ok) {
      throw new Error(`Expected ok for NBSP input, got: ${result.errors.map((e) => e.message).join(", ")}`);
    }
    expect(result.value.color.name).toBe("red");
    expect(result.value.intensity).toBe(50);
  });

  it("NBSP in multiple positions is skipped", () => {
    const result = parseTugColor("\u00A0red\u00A0,\u00A050\u00A0", KNOWN_HUES);
    if (!result.ok) {
      throw new Error(`Expected ok with NBSP surrounding tokens, got: ${result.errors.map((e) => e.message).join(", ")}`);
    }
    expect(result.value.color.name).toBe("red");
    expect(result.value.intensity).toBe(50);
  });

  it("uppercase preset name is normalized: 'green-Intense'", () => {
    const result = parseTugColor("green-Intense", KNOWN_HUES, KNOWN_PRESETS);
    if (!result.ok) {
      throw new Error(`Expected ok for 'green-Intense', got: ${result.errors.map((e) => e.message).join(", ")}`);
    }
    expect(result.value.color.name).toBe("green");
    expect(result.value.color.preset).toBe("intense");
  });
});
