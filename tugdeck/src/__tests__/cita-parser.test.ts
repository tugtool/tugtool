/**
 * Tests for cita-parser — the tokenizer and parser for --cita() color notation.
 *
 * Covers:
 * - Positional arguments (color only, color+i, color+i+t, all four)
 * - Labeled arguments (short and full label names, any order)
 * - Mixed positional + labeled
 * - Default values for intensity, tone, alpha
 * - Color hue offsets (+/- degrees, fractional)
 * - Fractional numeric values
 * - Error reporting: unknown colors, out-of-range, bad labels, type mismatches
 * - CSS value scanning (findCITACalls)
 */
import { describe, it, expect } from "bun:test";
import { parseCITA, findCITACalls } from "../../cita-parser";
import type { CITAParsed, CITAError } from "../../cita-parser";

// A representative set of known hues for testing
const KNOWN_HUES = new Set([
  "cherry", "red", "tomato", "flame", "orange", "amber", "gold", "yellow",
  "lime", "green", "mint", "teal", "cyan", "sky", "blue", "cobalt",
  "violet", "purple", "plum", "pink", "rose", "magenta", "berry", "coral",
  "black", "white",
]);

/** Assert a successful parse and return the parsed value. */
function expectOk(input: string): CITAParsed {
  const result = parseCITA(input, KNOWN_HUES);
  if (!result.ok) {
    throw new Error(
      `Expected ok parse for '${input}', got errors:\n` +
      result.errors.map((e) => `  - ${e.message}`).join("\n"),
    );
  }
  return result.value;
}

/** Assert a failed parse and return the error list. */
function expectErrors(input: string): CITAError[] {
  const result = parseCITA(input, KNOWN_HUES);
  if (result.ok) {
    throw new Error(
      `Expected errors for '${input}', got ok: ${JSON.stringify(result.value)}`,
    );
  }
  return result.errors;
}

// ---------------------------------------------------------------------------
// Positional arguments
// ---------------------------------------------------------------------------

describe("cita-parser: positional arguments", () => {
  it("color only — defaults for i/t/a", () => {
    const v = expectOk("green");
    expect(v.color).toEqual({ name: "green", offset: 0 });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(50);
    expect(v.alpha).toBe(100);
  });

  it("color + intensity — defaults for t/a", () => {
    const v = expectOk("violet, 30");
    expect(v.color).toEqual({ name: "violet", offset: 0 });
    expect(v.intensity).toBe(30);
    expect(v.tone).toBe(50);
    expect(v.alpha).toBe(100);
  });

  it("color + intensity + tone — default for a", () => {
    const v = expectOk("red, 50, 40");
    expect(v.color).toEqual({ name: "red", offset: 0 });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(40);
    expect(v.alpha).toBe(100);
  });

  it("all four positional", () => {
    const v = expectOk("red, 50, 40, 80");
    expect(v.color).toEqual({ name: "red", offset: 0 });
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

describe("cita-parser: labeled arguments", () => {
  it("all labeled with short names", () => {
    const v = expectOk("c: red, i: 50, t: 40, a: 100");
    expect(v.color).toEqual({ name: "red", offset: 0 });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(40);
    expect(v.alpha).toBe(100);
  });

  it("all labeled with full names", () => {
    const v = expectOk("color: red, intensity: 30, tone: 20, alpha: 100");
    expect(v.color).toEqual({ name: "red", offset: 0 });
    expect(v.intensity).toBe(30);
    expect(v.tone).toBe(20);
    expect(v.alpha).toBe(100);
  });

  it("labeled in arbitrary order", () => {
    const v = expectOk("t: 40, a: 80, c: purple, i: 12");
    expect(v.color).toEqual({ name: "purple", offset: 0 });
    expect(v.intensity).toBe(12);
    expect(v.tone).toBe(40);
    expect(v.alpha).toBe(80);
  });

  it("sparse labeled — just color and tone", () => {
    const v = expectOk("c: coral, t: 20");
    expect(v.color).toEqual({ name: "coral", offset: 0 });
    expect(v.intensity).toBe(50); // default
    expect(v.tone).toBe(20);
    expect(v.alpha).toBe(100); // default
  });

  it("sparse labeled — just color and alpha", () => {
    const v = expectOk("c: sky, a: 50");
    expect(v.color).toEqual({ name: "sky", offset: 0 });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(50);
    expect(v.alpha).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Mixed positional + labeled
// ---------------------------------------------------------------------------

describe("cita-parser: mixed positional + labeled", () => {
  it("positional color, labeled tone", () => {
    const v = expectOk("coral, t: 20");
    expect(v.color).toEqual({ name: "coral", offset: 0 });
    expect(v.intensity).toBe(50);
    expect(v.tone).toBe(20);
    expect(v.alpha).toBe(100);
  });

  it("positional color + intensity, labeled alpha", () => {
    const v = expectOk("blue, 70, a: 50");
    expect(v.color).toEqual({ name: "blue", offset: 0 });
    expect(v.intensity).toBe(70);
    expect(v.tone).toBe(50);
    expect(v.alpha).toBe(50);
  });

  it("positional color, labeled intensity and tone", () => {
    const v = expectOk("mint, i: 80, t: 30");
    expect(v.color).toEqual({ name: "mint", offset: 0 });
    expect(v.intensity).toBe(80);
    expect(v.tone).toBe(30);
    expect(v.alpha).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Color hue offsets
// ---------------------------------------------------------------------------

describe("cita-parser: color hue offsets", () => {
  it("positive integer offset", () => {
    const v = expectOk("red+5");
    expect(v.color).toEqual({ name: "red", offset: 5 });
  });

  it("negative integer offset", () => {
    const v = expectOk("green-10");
    expect(v.color).toEqual({ name: "green", offset: -10 });
  });

  it("positive fractional offset", () => {
    const v = expectOk("red+5.2");
    expect(v.color).toEqual({ name: "red", offset: 5.2 });
  });

  it("negative fractional offset", () => {
    const v = expectOk("cherry-2.5");
    expect(v.color).toEqual({ name: "cherry", offset: -2.5 });
  });

  it("color offset with labeled args", () => {
    const v = expectOk("c: red+5, i: 30, t: 70");
    expect(v.color).toEqual({ name: "red", offset: 5 });
    expect(v.intensity).toBe(30);
    expect(v.tone).toBe(70);
  });

  it("color offset positional with other positional args", () => {
    const v = expectOk("tomato-3, 60, 40");
    expect(v.color).toEqual({ name: "tomato", offset: -3 });
    expect(v.intensity).toBe(60);
    expect(v.tone).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Fractional numeric values
// ---------------------------------------------------------------------------

describe("cita-parser: fractional values", () => {
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

describe("cita-parser: whitespace tolerance", () => {
  it("no spaces", () => {
    const v = expectOk("c:red,i:50,t:40,a:100");
    expect(v.color).toEqual({ name: "red", offset: 0 });
    expect(v.intensity).toBe(50);
  });

  it("extra spaces everywhere", () => {
    const v = expectOk("  c :  red + 5  ,  i : 30  ,  t : 70  ");
    expect(v.color).toEqual({ name: "red", offset: 5 });
    expect(v.intensity).toBe(30);
    expect(v.tone).toBe(70);
  });

  it("tabs and mixed whitespace", () => {
    const v = expectOk("c:\tred,\ti:\t50");
    expect(v.color).toEqual({ name: "red", offset: 0 });
    expect(v.intensity).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Error reporting
// ---------------------------------------------------------------------------

describe("cita-parser: error reporting", () => {
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
    expect(errs.some((e) => e.message.includes("Empty --cita()"))).toBe(true);
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

describe("cita-parser: black and white", () => {
  it("black parses as a valid color", () => {
    const v = expectOk("black");
    expect(v.color).toEqual({ name: "black", offset: 0 });
  });

  it("white parses as a valid color", () => {
    const v = expectOk("white");
    expect(v.color).toEqual({ name: "white", offset: 0 });
  });

  it("black with alpha", () => {
    const v = expectOk("black, a: 50");
    expect(v.color.name).toBe("black");
    expect(v.alpha).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// findCITACalls — CSS value scanning
// ---------------------------------------------------------------------------

describe("findCITACalls: CSS value scanning", () => {
  it("finds a single --cita() call", () => {
    const calls = findCITACalls("--cita(red, 50, 50)");
    expect(calls.length).toBe(1);
    expect(calls[0].inner).toBe("red, 50, 50");
    expect(calls[0].start).toBe(0);
    expect(calls[0].end).toBe(19);
  });

  it("finds multiple --cita() calls in one value", () => {
    const calls = findCITACalls(
      "linear-gradient(--cita(blue, i: 5, t: 13), --cita(red, 50, 50))",
    );
    expect(calls.length).toBe(2);
    expect(calls[0].inner).toBe("blue, i: 5, t: 13");
    expect(calls[1].inner).toBe("red, 50, 50");
  });

  it("returns empty array when no --cita() calls present", () => {
    expect(findCITACalls("oklch(0.5 0.1 230)")).toEqual([]);
    expect(findCITACalls("var(--tug-blue)")).toEqual([]);
    expect(findCITACalls("#3b82f6")).toEqual([]);
  });

  it("handles nested parentheses", () => {
    const calls = findCITACalls("linear-gradient(to right, --cita(blue, 50, 50) 50%, white)");
    expect(calls.length).toBe(1);
    expect(calls[0].inner).toBe("blue, 50, 50");
  });

  it("ignores unmatched parenthesis", () => {
    const calls = findCITACalls("--cita(red");
    expect(calls.length).toBe(0);
  });

  it("extracts correct start/end positions", () => {
    const input = "bg: --cita(green); color: --cita(red+5, i: 80);";
    const calls = findCITACalls(input);
    expect(calls.length).toBe(2);
    expect(input.slice(calls[0].start, calls[0].end)).toBe("--cita(green)");
    expect(input.slice(calls[1].start, calls[1].end)).toBe("--cita(red+5, i: 80)");
  });
});
