/**
 * Step 8 integration: round-trip verification across all converted theme tokens.
 *
 * For every --tug-color() call in tug-base.css, bluenote.css, and harmony.css:
 * 1. Expand via the PostCSS plugin to get an oklch() string.
 * 2. Run oklchToTugColor() on the expanded oklch.
 * 3. Re-expand the recovered --tug-color() call via the plugin.
 * 4. Verify the two oklch strings match (within rounding tolerance).
 *
 * Also verifies:
 * - tug-palette.css is unmodified (no --tug-color() calls).
 * - brio.css is unmodified (no --tug-color() calls).
 * - Zero standalone hex values remain in the three theme file body{} blocks.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import postcss from "postcss";
import postcssTugColor from "../../postcss-tug-color";
import { oklchToTugColor } from "@/components/tugways/palette-engine";

const STYLES_DIR = join(import.meta.dir, "../../styles");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandTugColorInCSS(css: string): string {
  return postcss([postcssTugColor()]).process(css, { from: undefined }).css;
}

function parseOklch(s: string): { L: number; C: number; h: number } | null {
  const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+)?\s*\)/);
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

/** Extract all --tug-color() calls from a CSS string. */
function extractTugColorCalls(css: string): string[] {
  const pattern = /--tug-color\([^)]+\)/g;
  return css.match(pattern) ?? [];
}

/** Extract all standalone #hex values from declaration lines (not in rgba/url/comments). */
function extractStandaloneHex(css: string): string[] {
  const lines = css.split("\n");
  const standaloneHex: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    const hexPattern = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
    let m;
    while ((m = hexPattern.exec(trimmed)) !== null) {
      const before = trimmed.slice(0, m.index);
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
  it("contains no --tug-color() calls", () => {
    const css = readFileSync(join(STYLES_DIR, "tug-palette.css"), "utf8");
    expect(extractTugColorCalls(css)).toHaveLength(0);
  });
});

describe("Step 8: brio.css is unmodified", () => {
  it("contains no --tug-color() calls", () => {
    const css = readFileSync(join(STYLES_DIR, "brio.css"), "utf8");
    expect(extractTugColorCalls(css)).toHaveLength(0);
  });
});

describe("Step 8: zero standalone hex values in theme files", () => {
  it("tug-base.css has no standalone hex values", () => {
    const css = readFileSync(join(STYLES_DIR, "tug-base.css"), "utf8");
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
// --tug-color() expansion: all calls expand to valid oklch()
// ---------------------------------------------------------------------------

describe("Step 8: all --tug-color() calls expand to valid oklch()", () => {
  const themeFiles = ["tug-base.css", "bluenote.css", "harmony.css"];

  for (const file of themeFiles) {
    it(`${file}: every --tug-color() call expands to a parseable oklch()`, () => {
      const css = readFileSync(join(STYLES_DIR, file), "utf8");
      const calls = extractTugColorCalls(css);
      expect(calls.length).toBeGreaterThan(0);

      const failures: string[] = [];
      for (const call of calls) {
        const expanded = expandTugColorInCSS(`a { color: ${call}; }`);
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
// oklchToTugColor round-trip across all theme tokens
// ---------------------------------------------------------------------------

describe("Step 8: oklchToTugColor() round-trip across all converted tokens", () => {
  const themeFiles = ["tug-base.css", "bluenote.css", "harmony.css"];

  for (const file of themeFiles) {
    it(`${file}: round-trip stays within delta-E < 0.02 for all tokens`, () => {
      const css = readFileSync(join(STYLES_DIR, file), "utf8");
      const calls = extractTugColorCalls(css);

      const failures: Array<{ call: string; dE: number }> = [];

      for (const call of calls) {
        // Step 1: expand original --tug-color() to oklch
        const expanded1CSS = expandTugColorInCSS(`a { color: ${call}; }`);
        const m1 = expanded1CSS.match(/color:\s*(oklch\([^)]+\))/);
        if (!m1) continue;
        const oklch1 = m1[1];
        const parsed1 = parseOklch(oklch1);
        if (!parsed1) continue;

        // Step 2: recover TugColor params via oklchToTugColor
        const recovered = oklchToTugColor(oklch1);
        const recoveredCall = `--tug-color(${recovered.hue}, ${recovered.intensity}, ${recovered.tone})`;

        // Step 3: re-expand recovered --tug-color()
        const expanded2CSS = expandTugColorInCSS(`a { color: ${recoveredCall}; }`);
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
// PostCSS plugin: declaration values have no --tug-color() remnants after expansion
// ---------------------------------------------------------------------------

describe("Step 8: --tug-color() calls are fully expanded in theme files", () => {
  it("tug-base.css: processing through plugin produces zero --tug-color() in declaration values", () => {
    const css = readFileSync(join(STYLES_DIR, "tug-base.css"), "utf8");
    const result = expandTugColorInCSS(css);
    const root = postcss.parse(result);
    const remaining: string[] = [];
    root.walkDecls((decl) => {
      if (decl.value.includes("--tug-color(")) remaining.push(`${decl.prop}: ${decl.value}`);
    });
    expect(remaining).toHaveLength(0);
  });

  it("bluenote.css: processing through plugin produces zero --tug-color() in declaration values", () => {
    const css = readFileSync(join(STYLES_DIR, "bluenote.css"), "utf8");
    const result = expandTugColorInCSS(css);
    const root = postcss.parse(result);
    const remaining: string[] = [];
    root.walkDecls((decl) => {
      if (decl.value.includes("--tug-color(")) remaining.push(`${decl.prop}: ${decl.value}`);
    });
    expect(remaining).toHaveLength(0);
  });

  it("harmony.css: processing through plugin produces zero --tug-color() in declaration values", () => {
    const css = readFileSync(join(STYLES_DIR, "harmony.css"), "utf8");
    const result = expandTugColorInCSS(css);
    const root = postcss.parse(result);
    const remaining: string[] = [];
    root.walkDecls((decl) => {
      if (decl.value.includes("--tug-color(")) remaining.push(`${decl.prop}: ${decl.value}`);
    });
    expect(remaining).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D06 contrast-critical override verification
// ---------------------------------------------------------------------------

describe("Step 8: D06 contrast-critical overrides in harmony.css are correct", () => {
  const harmonyCss = readFileSync(join(STYLES_DIR, "harmony.css"), "utf8");

  const d06Expected: Array<{ token: string; tugColor: string }> = [
    { token: "--tug-base-tone-caution-fg",  tugColor: "--tug-color(yellow, i: 46, t: 27)" },
    { token: "--tug-base-field-tone-caution",   tugColor: "--tug-color(yellow, i: 62, t: 58)" },
  ];

  for (const { token, tugColor } of d06Expected) {
    it(`${token} equals ${tugColor}`, () => {
      const pattern = new RegExp(`${token.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}:\\s*(--tug-color\\([^)]+\\))`);
      const m = harmonyCss.match(pattern);
      expect(m).not.toBeNull();
      // Normalise whitespace for comparison
      const actual = m![1].replace(/\s+/g, " ").trim();
      const expected = tugColor.replace(/\s+/g, " ").trim();
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
    expect(extractStandaloneHex(harmonyCss).filter(h => h.toLowerCase() === "#ffffff")).toHaveLength(0);
  });
});
