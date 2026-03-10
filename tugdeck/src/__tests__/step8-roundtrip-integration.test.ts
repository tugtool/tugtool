/**
 * Step 8 integration: round-trip verification across all converted theme tokens.
 *
 * For every --hvv() call in tug-tokens.css, bluenote.css, and harmony.css:
 * 1. Expand via the PostCSS plugin to get an oklch() string.
 * 2. Run oklchToHVV() on the expanded oklch.
 * 3. Re-expand the recovered --hvv() call via the plugin.
 * 4. Verify the two oklch strings match (within rounding tolerance).
 *
 * Also verifies:
 * - tug-palette.css is unmodified (no --hvv() calls).
 * - brio.css is unmodified (no --hvv() calls).
 * - Zero standalone hex values remain in the three theme file body{} blocks.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import postcss from "postcss";
import postcssHvv from "../../postcss-hvv";
import { oklchToHVV } from "@/components/tugways/palette-engine";

const STYLES_DIR = join(import.meta.dir, "../../styles");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandHvvInCSS(css: string): string {
  return postcss([postcssHvv()]).process(css, { from: undefined }).css;
}

function parseOklch(s: string): { L: number; C: number; h: number } | null {
  const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!m) return null;
  return { L: parseFloat(m[1]), C: parseFloat(m[2]), h: parseFloat(m[3]) };
}

function oklchDeltaE(
  a: { L: number; C: number; h: number },
  b: { L: number; C: number; h: number },
): number {
  const dL = a.L - b.L;
  const dC = a.C - b.C;
  let dH = a.h - b.h;
  if (dH > 180) dH -= 360;
  if (dH < -180) dH += 360;
  const avgC = (a.C + b.C) / 2;
  const dHCart = 2 * avgC * Math.sin((dH * Math.PI) / 180 / 2);
  return Math.sqrt(dL * dL + dC * dC + dHCart * dHCart);
}

/** Extract all --hvv() calls from a CSS string. */
function extractHvvCalls(css: string): string[] {
  const pattern = /--hvv\(\s*(?:hue-\d+|[a-z]+|\d+(?:\.\d+)?)\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*\)/g;
  return css.match(pattern) ?? [];
}

/** Extract all standalone #hex values from declaration lines (not in rgba/color-mix/comments). */
function extractStandaloneHex(css: string): string[] {
  const lines = css.split("\n");
  const standaloneHex: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    // Match hex values not inside function calls
    const hexPattern = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
    let m;
    while ((m = hexPattern.exec(trimmed)) !== null) {
      const before = trimmed.slice(0, m.index);
      // Skip if inside a function call (has unmatched open paren before hex)
      let depth = 0;
      let insideFunc = false;
      for (let i = before.length - 1; i >= 0; i--) {
        if (before[i] === ")") depth++;
        else if (before[i] === "(") {
          if (depth > 0) depth--;
          else if (i > 0 && /\w/.test(before[i - 1])) { insideFunc = true; break; }
        }
      }
      if (!insideFunc) standaloneHex.push(m[0]);
    }
  }
  return standaloneHex;
}

// ---------------------------------------------------------------------------
// Theme file integrity checks
// ---------------------------------------------------------------------------

describe("Step 8: tug-palette.css is unmodified", () => {
  it("contains no --hvv() calls", () => {
    const css = readFileSync(join(STYLES_DIR, "tug-palette.css"), "utf8");
    expect(extractHvvCalls(css)).toHaveLength(0);
  });
});

describe("Step 8: brio.css is unmodified", () => {
  it("contains no --hvv() calls", () => {
    const css = readFileSync(join(STYLES_DIR, "brio.css"), "utf8");
    expect(extractHvvCalls(css)).toHaveLength(0);
  });
});

describe("Step 8: zero standalone hex values in theme files", () => {
  it("tug-tokens.css has no standalone hex values", () => {
    const css = readFileSync(join(STYLES_DIR, "tug-tokens.css"), "utf8");
    expect(extractStandaloneHex(css)).toHaveLength(0);
  });

  it("bluenote.css has no standalone hex values", () => {
    const css = readFileSync(join(STYLES_DIR, "bluenote.css"), "utf8");
    expect(extractStandaloneHex(css)).toHaveLength(0);
  });

  it("harmony.css has no standalone hex values", () => {
    const css = readFileSync(join(STYLES_DIR, "harmony.css"), "utf8");
    expect(extractStandaloneHex(css)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// --hvv() expansion: all calls expand to valid oklch()
// ---------------------------------------------------------------------------

describe("Step 8: all --hvv() calls expand to valid oklch()", () => {
  const themeFiles = ["tug-tokens.css", "bluenote.css", "harmony.css"];

  for (const file of themeFiles) {
    it(`${file}: every --hvv() call expands to a parseable oklch()`, () => {
      const css = readFileSync(join(STYLES_DIR, file), "utf8");
      const calls = extractHvvCalls(css);
      expect(calls.length).toBeGreaterThan(0);

      const failures: string[] = [];
      for (const call of calls) {
        const expanded = expandHvvInCSS(`a { color: ${call}; }`);
        const m = expanded.match(/color:\s*(oklch\([^)]+\))/);
        if (!m) {
          failures.push(`${call} → not expanded`);
          continue;
        }
        if (!parseOklch(m[1])) {
          failures.push(`${call} → unparseable: ${m[1]}`);
        }
      }
      expect(failures).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// oklchToHVV round-trip across all theme tokens
// ---------------------------------------------------------------------------

describe("Step 8: oklchToHVV() round-trip across all converted tokens", () => {
  const themeFiles = ["tug-tokens.css", "bluenote.css", "harmony.css"];

  for (const file of themeFiles) {
    it(`${file}: round-trip stays within delta-E < 0.02 for all tokens`, () => {
      const css = readFileSync(join(STYLES_DIR, file), "utf8");
      const calls = extractHvvCalls(css);

      const failures: Array<{ call: string; dE: number }> = [];

      for (const call of calls) {
        // Step 1: expand original --hvv() to oklch
        const expanded1CSS = expandHvvInCSS(`a { color: ${call}; }`);
        const m1 = expanded1CSS.match(/color:\s*(oklch\([^)]+\))/);
        if (!m1) continue;
        const oklch1 = m1[1];
        const parsed1 = parseOklch(oklch1);
        if (!parsed1) continue;

        // Step 2: recover HVV params via oklchToHVV
        const recovered = oklchToHVV(oklch1);
        const recoveredCall = `--hvv(${recovered.hue}, ${recovered.vib}, ${recovered.val})`;

        // Step 3: re-expand recovered --hvv()
        const expanded2CSS = expandHvvInCSS(`a { color: ${recoveredCall}; }`);
        const m2 = expanded2CSS.match(/color:\s*(oklch\([^)]+\))/);
        if (!m2) continue;
        const parsed2 = parseOklch(m2[1]);
        if (!parsed2) continue;

        // Step 4: compare
        const dE = oklchDeltaE(parsed1, parsed2);
        if (dE >= 0.02) {
          failures.push({ call, dE });
        }
      }

      if (failures.length > 0) {
        const report = failures.map(f => `  ${f.call}: delta-E=${f.dE.toFixed(4)}`).join("\n");
        throw new Error(`${failures.length} round-trip failure(s) in ${file}:\n${report}`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// PostCSS plugin + Vite integration: declaration values have no --hvv() remnants
// Comments may reference --hvv() notation for documentation; only values matter.
// ---------------------------------------------------------------------------

/** Check that no declaration value in the CSS contains --hvv() after expansion. */
function declarationValuesHaveNoHvv(css: string): string[] {
  const root = postcss.parse(css);
  const remaining: string[] = [];
  root.walkDecls((decl) => {
    if (decl.value.includes("--hvv(")) {
      remaining.push(`${decl.prop}: ${decl.value}`);
    }
  });
  return remaining;
}

describe("Step 8: --hvv() calls are fully expanded in theme files", () => {
  it("tug-tokens.css: processing through plugin produces zero --hvv() in declaration values", () => {
    const css = readFileSync(join(STYLES_DIR, "tug-tokens.css"), "utf8");
    const result = expandHvvInCSS(css);
    expect(declarationValuesHaveNoHvv(result)).toHaveLength(0);
  });

  it("bluenote.css: processing through plugin produces zero --hvv() in declaration values", () => {
    const css = readFileSync(join(STYLES_DIR, "bluenote.css"), "utf8");
    const result = expandHvvInCSS(css);
    expect(declarationValuesHaveNoHvv(result)).toHaveLength(0);
  });

  it("harmony.css: processing through plugin produces zero --hvv() in declaration values", () => {
    const css = readFileSync(join(STYLES_DIR, "harmony.css"), "utf8");
    const result = expandHvvInCSS(css);
    expect(declarationValuesHaveNoHvv(result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D06 contrast-critical override verification
// ---------------------------------------------------------------------------

describe("Step 8: D06 contrast-critical overrides in harmony.css are correct", () => {
  const harmonyCss = readFileSync(join(STYLES_DIR, "harmony.css"), "utf8");

  const d06Expected: Array<{ token: string; hvv: string }> = [
    { token: "--tug-base-accent-muted",    hvv: "--hvv(flame, 45, 38)"  },
    { token: "--tug-base-toast-warning-fg", hvv: "--hvv(yellow, 55, 35)" },
    { token: "--tug-base-badge-warning-fg", hvv: "--hvv(yellow, 46, 27)" },
    { token: "--tug-base-banner-info-fg",   hvv: "--hvv(blue, 42, 40)"   },
    { token: "--tug-base-field-warning",    hvv: "--hvv(yellow, 62, 58)" },
  ];

  for (const { token, hvv } of d06Expected) {
    it(`${token} equals ${hvv}`, () => {
      const pattern = new RegExp(`${token.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}:\\s*(--hvv\\([^)]+\\))`);
      const m = harmonyCss.match(pattern);
      expect(m).not.toBeNull();
      // Normalise whitespace for comparison
      const actual = m![1].replace(/\s+/g, " ").trim();
      const expected = hvv.replace(/\s+/g, " ").trim();
      expect(actual).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// #ffffff → var(--tug-white) in harmony.css
// ---------------------------------------------------------------------------

describe("Step 8: #ffffff converted to var(--tug-white) in harmony.css", () => {
  const harmonyCss = readFileSync(join(STYLES_DIR, "harmony.css"), "utf8");

  it("contains at least one var(--tug-white) declaration", () => {
    expect(harmonyCss).toContain("var(--tug-white)");
  });

  it("contains no standalone #ffffff declarations", () => {
    // Find #ffffff not inside function calls or comments
    expect(extractStandaloneHex(harmonyCss).filter(h => h.toLowerCase() === "#ffffff")).toHaveLength(0);
  });
});
