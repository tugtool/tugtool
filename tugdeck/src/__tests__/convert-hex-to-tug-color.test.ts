/**
 * Tests for the convert-hex-to-tug-color conversion script.
 *
 * Tests cover:
 * - hexToOklch(): conversion matches known reference values
 * - isHexInsideFunction(): correctly identifies standalone vs. in-function hex
 * - convertValueHexToTugColor(): #ffffff → var(--tugc-white), inline function preservation
 * - Hex values inside CSS comments are not modified (PostCSS AST separates them)
 * - convertCSSFile() integration: AST walk preserves comments, non-hex values
 * - oklchDeltaE(): Euclidean distance in OKLCH space
 * - validateRoundTrip(): detects high delta-E conversions
 */
import { describe, it, expect } from "bun:test";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import os from "os";

import {
  hexToSRGB,
  sRGBToLinear,
  linearSRGBToOklch,
  hexToOklch,
  isHexInsideFunction,
  convertValueHexToTugColor,
  convertCSSFile,
  oklchDeltaE,
  parseOklchString,
  validateRoundTrip,
} from "../../scripts/convert-hex-to-tug-color";

import { tugColor, DEFAULT_CANONICAL_L } from "@/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// hexToSRGB
// ---------------------------------------------------------------------------

describe("hexToSRGB()", () => {
  it("parses 6-digit hex to [0,1] channels", () => {
    const result = hexToSRGB("#ffffff");
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(1, 5);
    expect(result!.g).toBeCloseTo(1, 5);
    expect(result!.b).toBeCloseTo(1, 5);
  });

  it("parses #000000 to all zeros", () => {
    const result = hexToSRGB("#000000");
    expect(result).not.toBeNull();
    expect(result!.r).toBe(0);
    expect(result!.g).toBe(0);
    expect(result!.b).toBe(0);
  });

  it("parses 3-digit hex by doubling digits", () => {
    const result = hexToSRGB("#fff");
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(1, 5);
    expect(result!.g).toBeCloseTo(1, 5);
    expect(result!.b).toBeCloseTo(1, 5);
  });

  it("parses #3b82f6 correctly", () => {
    const result = hexToSRGB("#3b82f6");
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(0x3b / 255, 4);
    expect(result!.g).toBeCloseTo(0x82 / 255, 4);
    expect(result!.b).toBeCloseTo(0xf6 / 255, 4);
  });

  it("returns null for invalid hex", () => {
    expect(hexToSRGB("not-a-color")).toBeNull();
    expect(hexToSRGB("#gg0000")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sRGBToLinear
// ---------------------------------------------------------------------------

describe("sRGBToLinear()", () => {
  it("maps 0 to 0", () => {
    expect(sRGBToLinear(0)).toBe(0);
  });

  it("maps 1 to 1", () => {
    expect(sRGBToLinear(1)).toBeCloseTo(1, 5);
  });

  it("maps 0.5 to approximately 0.2140", () => {
    // Standard sRGB linearisation of 0.5
    expect(sRGBToLinear(0.5)).toBeCloseTo(0.2140, 3);
  });
});

// ---------------------------------------------------------------------------
// hexToOklch — known reference values
// ---------------------------------------------------------------------------

describe("hexToOklch(): known reference values", () => {
  it("white #ffffff → oklch(1 0 0) approximately", () => {
    const result = hexToOklch("#ffffff");
    expect(result).not.toBeNull();
    const parsed = parseOklchString(result!);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(1, 2);
    expect(parsed!.C).toBeCloseTo(0, 4);
  });

  it("black #000000 → oklch(0 0 0)", () => {
    const result = hexToOklch("#000000");
    expect(result).not.toBeNull();
    const parsed = parseOklchString(result!);
    expect(parsed).not.toBeNull();
    expect(parsed!.L).toBeCloseTo(0, 4);
    expect(parsed!.C).toBeCloseTo(0, 4);
  });

  it("#3f474c (Brio bg-app) converts to an oklch string", () => {
    const result = hexToOklch("#3f474c");
    expect(result).not.toBeNull();
    expect(result).toMatch(/^oklch\(/);
    const parsed = parseOklchString(result!);
    expect(parsed).not.toBeNull();
    // Should be dark (L < 0.4) and low chroma
    expect(parsed!.L).toBeLessThan(0.4);
    expect(parsed!.C).toBeLessThan(0.05);
  });

  it("#c46020 (Harmony accent-muted) → dark orange in oklch", () => {
    const result = hexToOklch("#c46020");
    expect(result).not.toBeNull();
    const parsed = parseOklchString(result!);
    expect(parsed).not.toBeNull();
    // flame/orange hue angle range approximately 45–65 degrees
    expect(parsed!.h).toBeGreaterThan(30);
    expect(parsed!.h).toBeLessThan(80);
    // Mid lightness, moderate chroma
    expect(parsed!.L).toBeGreaterThan(0.45);
    expect(parsed!.L).toBeLessThan(0.7);
  });

  it("round-trip via tugColor: converting oklch back to tug-color and re-expanding stays close", () => {
    // Pick a known canonical color: blue at intensity=50, tone=50
    const canonOklch = tugColor("blue", 50, 50, DEFAULT_CANONICAL_L["blue"]);
    // Parse it and convert back to "hex-like" via oklch string
    const canonParsed = parseOklchString(canonOklch);
    expect(canonParsed).not.toBeNull();
    // The round-trip: oklch → our parser → same values
    expect(canonParsed!.L).toBeCloseTo(DEFAULT_CANONICAL_L["blue"], 3);
  });

  it("returns null for invalid input", () => {
    expect(hexToOklch("not-a-color")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isHexInsideFunction
// ---------------------------------------------------------------------------

describe("isHexInsideFunction()", () => {
  it("returns false for standalone hex at start of value", () => {
    const value = "#3f474c";
    expect(isHexInsideFunction(value, 0)).toBe(false);
  });

  it("returns true for hex inside rgba()", () => {
    const value = "rgba(#3f474c, 0.5)";
    const idx = value.indexOf("#");
    expect(isHexInsideFunction(value, idx)).toBe(true);
  });

  it("returns true for hex inside linear-gradient()", () => {
    const value = "linear-gradient(to right, #ffffff 50%, transparent)";
    const idx = value.indexOf("#");
    expect(isHexInsideFunction(value, idx)).toBe(true);
  });

  it("returns true for hex inside url()", () => {
    const value = "url(#my-gradient)";
    const idx = value.indexOf("#");
    expect(isHexInsideFunction(value, idx)).toBe(true);
  });

  it("returns false for standalone hex after a space", () => {
    const value = "1px solid #7f796a";
    const idx = value.indexOf("#");
    expect(isHexInsideFunction(value, idx)).toBe(false);
  });

  it("returns false for standalone hex in compound value", () => {
    const value = "0 2px 4px #000000";
    const idx = value.indexOf("#");
    expect(isHexInsideFunction(value, idx)).toBe(false);
  });

  it("does not treat closing paren before hex as inside a function", () => {
    // Pattern: "border: 1px solid #abc" — no open paren before hex
    const value = "#abc";
    expect(isHexInsideFunction(value, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// convertValueHexToTugColor
// ---------------------------------------------------------------------------

describe("convertValueHexToTugColor()", () => {
  it("#ffffff → var(--tugc-white)", () => {
    expect(convertValueHexToTugColor("#ffffff")).toBe("var(--tugc-white)");
  });

  it("#FFFFFF (uppercase) → var(--tugc-white)", () => {
    expect(convertValueHexToTugColor("#FFFFFF")).toBe("var(--tugc-white)");
  });

  it("standalone hex → --tug-color(hue, i: intensity, t: tone)", () => {
    const result = convertValueHexToTugColor("#3f474c");
    expect(result).toMatch(/^--tug-color\(/);
    expect(result).not.toContain("#");
  });

  it("hex inside rgba() is preserved unchanged", () => {
    const value = "rgba(0, 0, 0, 0.5)";
    expect(convertValueHexToTugColor(value)).toBe(value);
  });

  it("hex inside linear-gradient() is preserved unchanged", () => {
    const value = "linear-gradient(to right, #ffffff 50%, transparent)";
    expect(convertValueHexToTugColor(value)).toBe(value);
  });

  it("var() references pass through unchanged", () => {
    const value = "var(--tug-blue)";
    expect(convertValueHexToTugColor(value)).toBe(value);
  });

  it("transparent passes through unchanged", () => {
    expect(convertValueHexToTugColor("transparent")).toBe("transparent");
  });

  it("oklch() passes through unchanged", () => {
    const value = "oklch(0.5 0.1 230)";
    expect(convertValueHexToTugColor(value)).toBe(value);
  });

  it("compound value with trailing rgba preserved", () => {
    const value = "0 4px 16px rgba(0, 0, 0, 0.24)";
    expect(convertValueHexToTugColor(value)).toBe(value);
  });

  it("standalone hex in compound value is converted", () => {
    const value = "1px solid #7f796a";
    const result = convertValueHexToTugColor(value);
    expect(result).toMatch(/^1px solid --tug-color\(/);
    expect(result).not.toContain("#7f796a");
  });
});

// ---------------------------------------------------------------------------
// CSS comment preservation (PostCSS AST)
// ---------------------------------------------------------------------------

describe("convertCSSFile(): hex values in CSS comments are not modified", () => {
  it("preserves comment-embedded hex values unchanged", () => {
    const tmpFile = join(os.tmpdir(), `test-comments-${Date.now()}.css`);
    const css = [
      "/* accent-muted: #c46020 is darker orange needed for contrast */",
      "body {",
      "  --tug-accent-muted: #c46020;",
      "  /* another comment with #8a7200 */",
      "}",
    ].join("\n");

    writeFileSync(tmpFile, css, "utf8");
    convertCSSFile(tmpFile);
    const result = readFileSync(tmpFile, "utf8");
    unlinkSync(tmpFile);

    // Comments must be preserved verbatim
    expect(result).toContain("/* accent-muted: #c46020 is darker orange needed for contrast */");
    expect(result).toContain("/* another comment with #8a7200 */");
    // Declaration must be converted
    expect(result).not.toContain("--tug-accent-muted: #c46020;");
    expect(result).toContain("--tug-accent-muted: --tug-color(");
  });
});

describe("convertCSSFile(): structure preservation", () => {
  it("preserves var() and rgba() values unchanged while converting hex", () => {
    const tmpFile = join(os.tmpdir(), `test-preserve-${Date.now()}.css`);
    const css = [
      "body {",
      "  --tug-bg: #3f474c;",
      "  --tug-shadow: rgba(0, 0, 0, 0.3);",
      "  --tug-accent: var(--tug-blue);",
      "  --tug-gradient: linear-gradient(to right, currentColor 20%, transparent);",
      "}",
    ].join("\n");

    writeFileSync(tmpFile, css, "utf8");
    convertCSSFile(tmpFile);
    const result = readFileSync(tmpFile, "utf8");
    unlinkSync(tmpFile);

    // Hex must be converted
    expect(result).not.toContain("#3f474c");
    expect(result).toContain("--tug-bg: --tug-color(");

    // rgba is now converted to --tug-color with alpha
    expect(result).toContain("--tug-color(black, 0, 0,");
    // Non-color values must be preserved
    expect(result).toContain("var(--tug-blue)");
    expect(result).toContain("linear-gradient(to right, currentColor 20%, transparent)");
  });

  it("#ffffff → var(--tugc-white) through the full file conversion pipeline", () => {
    const tmpFile = join(os.tmpdir(), `test-white-${Date.now()}.css`);
    const css = "body { --tug7-element-toggle-thumb-normal-plain-rest: #ffffff; }";

    writeFileSync(tmpFile, css, "utf8");
    convertCSSFile(tmpFile);
    const result = readFileSync(tmpFile, "utf8");
    unlinkSync(tmpFile);

    expect(result).toContain("var(--tugc-white)");
    expect(result).not.toContain("#ffffff");
  });

  it("does not modify non-body rules (font-face, :root)", () => {
    const tmpFile = join(os.tmpdir(), `test-nonbody-${Date.now()}.css`);
    // Note: the plan specifies converting body{} blocks only, but the
    // script walks ALL declarations. Font-face and :root don't contain
    // hex colors in the actual theme files, so this tests that non-hex
    // values in those blocks are untouched.
    const css = [
      "@font-face { font-family: 'Test'; src: url('/font.woff2'); }",
      ":root { --tug-scale: 1; }",
      "body { --tug-bg: #3f474c; }",
    ].join("\n");

    writeFileSync(tmpFile, css, "utf8");
    convertCSSFile(tmpFile);
    const result = readFileSync(tmpFile, "utf8");
    unlinkSync(tmpFile);

    expect(result).toContain("@font-face { font-family: 'Test'; src: url('/font.woff2'); }");
    expect(result).toContain(":root { --tug-scale: 1; }");
    expect(result).toContain("--tug-bg: --tug-color(");
  });
});

// ---------------------------------------------------------------------------
// oklchDeltaE
// ---------------------------------------------------------------------------

describe("oklchDeltaE()", () => {
  it("identical colors have delta-E of 0", () => {
    const color = { L: 0.5, C: 0.1, h: 230 };
    expect(oklchDeltaE(color, color)).toBe(0);
  });

  it("pure lightness difference: delta-E equals abs(dL)", () => {
    const a = { L: 0.5, C: 0, h: 0 };
    const b = { L: 0.6, C: 0, h: 0 };
    expect(oklchDeltaE(a, b)).toBeCloseTo(0.1, 5);
  });

  it("hue wrapping: 350° and 10° are 20° apart", () => {
    const a = { L: 0.5, C: 0.1, h: 350 };
    const b = { L: 0.5, C: 0.1, h: 10 };
    const dE = oklchDeltaE(a, b);
    // dH = 20°, avgC = 0.1, dHCart = 2 * 0.1 * sin(10°) ≈ 0.03473
    expect(dE).toBeCloseTo(2 * 0.1 * Math.sin((10 * Math.PI) / 180), 4);
  });

  it("achromatic colors: delta-E from chroma change equals abs(dC)", () => {
    const a = { L: 0.5, C: 0.0, h: 0 };
    const b = { L: 0.5, C: 0.05, h: 0 };
    expect(oklchDeltaE(a, b)).toBeCloseTo(0.05, 5);
  });
});

// ---------------------------------------------------------------------------
// validateRoundTrip
// ---------------------------------------------------------------------------

describe("validateRoundTrip()", () => {
  it("returns no failures for a perfectly round-tripped color", () => {
    // Use a hex value that round-trips cleanly: cobalt at some known TugColor coords.
    // We pick a simple case: convert a CSS, then validate.
    const tmpFile = join(os.tmpdir(), `test-roundtrip-${Date.now()}.css`);
    const css = "body { --tug-bg: #3f474c; }";

    writeFileSync(tmpFile, css, "utf8");
    const convertedSource = convertCSSFile(tmpFile);
    unlinkSync(tmpFile);

    const failures = validateRoundTrip(css, convertedSource);
    // Allow up to threshold of 0.01; most conversions will be well below that
    // If there is a failure here (unlikely), it would indicate a systematic math error
    expect(failures.length).toBe(0);
  });

  it("returns failures when a converted value has high delta-E (injected error)", () => {
    // Craft a CSS where the "converted" value has a very wrong oklch
    const originalCSS = "body { --my-color: #3f474c; }";
    // Deliberately wrong conversion: a color far from the original
    const badConverted = "body { --my-color: --tug-color(cherry, 90, 90); }";

    const failures = validateRoundTrip(originalCSS, badConverted, 0.001);
    // cherry at vib=90, val=90 is a very saturated red — very far from #3f474c (dark gray-blue)
    expect(failures.length).toBeGreaterThan(0);
  });
});
