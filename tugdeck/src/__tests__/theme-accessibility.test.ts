/**
 * Theme accessibility tests — pairing map completeness, WCAG/perceptual contrast,
 * auto-adjustment behavior, and calibration baseline.
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "bun:test";

import { ELEMENT_SURFACE_PAIRING_MAP, ContrastRole } from "@/components/tugways/theme-pairings";
import {
  computeWcagContrast,
  computePerceptualContrast,
  validateThemeContrast,
  autoAdjustContrast,
  compositeOverSurface,
  checkCVDDistinguishability,
  hexToOkLabL,
  CONTRAST_THRESHOLDS,
  CONTRAST_SCALE,
  POLARITY_FACTOR,
  CONTRAST_MIN_DELTA,
} from "@/components/tugways/theme-accessibility";
import {
  deriveTheme,
  EXAMPLE_RECIPES,
  type ResolvedColor,
} from "@/components/tugways/theme-engine";
import { oklchToHex } from "@/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// CSS parsing helpers
// ---------------------------------------------------------------------------

const STYLES_DIR = join(import.meta.dir, "../../styles");

function readInlinedThemeCSS(): string {
  return readFileSync(join(STYLES_DIR, "tug-base-generated.css"), "utf8");
}

function extractChromaticTokens(css: string): {
  fg: Set<string>;
  bg: Set<string>;
} {
  const fgTokens = new Set<string>();
  const bgTokens = new Set<string>();

  const bodyMatch = css.match(/body\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s);
  if (!bodyMatch) return { fg: fgTokens, bg: bgTokens };
  const bodyContent = bodyMatch[1];

  const declRegex = /(--tug-[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = declRegex.exec(bodyContent)) !== null) {
    const name = m[1];
    const value = m[2].trim();
    if (!value.includes("--tug-color(")) continue;

    const isFg =
      name.includes("-fg") ||
      name.includes("-icon") ||
      name.includes("checkmark") ||
      name.includes("radio-dot") ||
      name.includes("toggle-thumb");

    const isNotFgOrBorder =
      !name.endsWith("-fg") &&
      !name.endsWith("-icon") &&
      !name.endsWith("-border") &&
      !name.endsWith("-label") &&
      !name.endsWith("-ring") &&
      !name.endsWith("-dot") &&
      !name.endsWith("-thumb") &&
      !name.endsWith("-shortcut") &&
      !name.endsWith("-required") &&
      !name.endsWith("-error") &&
      !name.endsWith("-warning") &&
      !name.endsWith("-success");

    const isBg =
      isNotFgOrBorder &&
      (name.includes("-bg") ||
        name.includes("-surface") ||
        name.includes("selection-bg") ||
        name.includes("tone-accent-bg") ||
        name.includes("tone-active-bg") ||
        name.includes("tone-agent-bg") ||
        name.includes("tone-data-bg") ||
        name.includes("tone-success-bg") ||
        name.includes("tone-caution-bg") ||
        name.includes("tone-danger-bg") ||
        name.includes("accent-default") ||
        name.includes("accent-cool") ||
        name.includes("control-disabled-bg") ||
        name.includes("control-selected-bg") ||
        name.includes("control-highlighted-bg") ||
        name.includes("field-bg") ||
        name.includes("toggle-track"));

    if (isFg) fgTokens.add(name);
    if (isBg) bgTokens.add(name);
  }

  return { fg: fgTokens, bg: bgTokens };
}

// ---------------------------------------------------------------------------
// Test suite: pairing-map completeness and validity
// ---------------------------------------------------------------------------

describe("pairing-map", () => {
  const css = readInlinedThemeCSS();
  const { fg: chromaticFgTokens, bg: chromaticBgTokens } = extractChromaticTokens(css);

  const VALID_ROLES: Set<ContrastRole> = new Set([
    "content",
    "control",
    "display",
    "informational",
    "decorative",
  ]);

  it("T1.1: contains entries for all chromatic fg tokens in tug-base.css", () => {
    const mappedFgTokens = new Set(ELEMENT_SURFACE_PAIRING_MAP.map((p) => p.element));
    const missingFgTokens: string[] = [];
    for (const token of chromaticFgTokens) {
      if (!mappedFgTokens.has(token)) missingFgTokens.push(token);
    }
    expect(missingFgTokens).toEqual([]);
  });

  it("T1.1b: contains entries for all chromatic bg tokens in tug-base.css", () => {
    const mappedBgTokens = new Set(ELEMENT_SURFACE_PAIRING_MAP.map((p) => p.surface));
    const EXCLUDED_BG_TOKENS = new Set([
      "--tug-surface-control-primary-normal-selected-disabled",
      "--tug-surface-overlay-primary-normal-dim-rest",
      "--tug-surface-overlay-primary-normal-scrim-rest",
      "--tug-surface-overlay-primary-normal-highlight-rest",
      "--tug-surface-highlight-primary-normal-hover-rest",
      "--tug-surface-highlight-primary-normal-dropTarget-rest",
      "--tug-surface-highlight-primary-normal-preview-rest",
      "--tug-surface-highlight-primary-normal-inspectorTarget-rest",
      "--tug-surface-highlight-primary-normal-snapGuide-rest",
      "--tug-surface-highlight-primary-normal-flash-rest",
      "--tug-element-global-fill-normal-accentSubtle-rest",
      "--tug-surface-selection-primary-normal-plain-inactive",
      "--tug-surface-control-primary-ghost-action-hover",
      "--tug-surface-control-primary-ghost-action-active",
      "--tug-surface-control-primary-ghost-danger-hover",
      "--tug-surface-control-primary-ghost-danger-active",
      "--tug-surface-control-primary-outlined-option-hover",
      "--tug-surface-control-primary-outlined-option-active",
      "--tug-surface-control-primary-ghost-option-hover",
      "--tug-surface-control-primary-ghost-option-active",
      "--tug-surface-control-primary-normal-selected-hover",
      "--tug-surface-field-primary-normal-plain-disabled",
      "--tug-element-global-fill-normal-accentCool-rest",
      "--tug-surface-tab-primary-normal-plain-hover",
      "--tug-surface-tabClose-primary-normal-plain-hover",
      "--tug-surface-tab-primary-normal-plain-inactive",
      "--tug-surface-tab-primary-normal-plain-collapsed",
      "--tug-surface-global-primary-normal-grid-rest",
    ]);

    const missingBgTokens: string[] = [];
    for (const token of chromaticBgTokens) {
      if (!mappedBgTokens.has(token) && !EXCLUDED_BG_TOKENS.has(token)) {
        missingBgTokens.push(token);
      }
    }
    expect(missingBgTokens).toEqual([]);
  });

  it("T1.2: every entry has a valid role from the allowed set", () => {
    const invalidRoles: Array<{ element: string; surface: string; role: string }> = [];
    for (const pairing of ELEMENT_SURFACE_PAIRING_MAP) {
      if (!VALID_ROLES.has(pairing.role)) {
        invalidRoles.push({ element: pairing.element, surface: pairing.surface, role: pairing.role });
      }
    }
    expect(invalidRoles).toEqual([]);
  });

  it("T1.3: no duplicate element/surface pairs", () => {
    const seen = new Set<string>();
    const duplicates: Array<{ element: string; surface: string }> = [];
    for (const pairing of ELEMENT_SURFACE_PAIRING_MAP) {
      const key = `${pairing.element}|${pairing.surface}`;
      if (seen.has(key)) duplicates.push({ element: pairing.element, surface: pairing.surface });
      seen.add(key);
    }
    expect(duplicates).toEqual([]);
  });

  it("has at least 50 pairings (sanity check)", () => {
    expect(ELEMENT_SURFACE_PAIRING_MAP.length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// Test suite: theme-accessibility — perceptual contrast behavioral tests
// ---------------------------------------------------------------------------

describe("theme-accessibility", () => {
  it("T3.3: computePerceptualContrast returns correct polarity for dark-on-light vs light-on-dark", () => {
    const normalLc = computePerceptualContrast("#000000", "#ffffff");
    expect(normalLc).toBeGreaterThan(0);

    const reverseLc = computePerceptualContrast("#ffffff", "#000000");
    expect(reverseLc).toBeLessThan(0);

    expect(Math.abs(normalLc)).toBeGreaterThan(90);
    expect(Math.abs(reverseLc)).toBeGreaterThan(90);
  });

  it("T3.3b: computePerceptualContrast returns 0 when deltaL < CONTRAST_MIN_DELTA", () => {
    expect(CONTRAST_MIN_DELTA).toBeGreaterThan(0);
    expect(CONTRAST_MIN_DELTA).toBeLessThan(0.1);

    expect(computePerceptualContrast("#808080", "#808080")).toBe(0);
    expect(computePerceptualContrast("#3a4050", "#3a4050")).toBe(0);
  });

  it("T3.3c: white-on-black and black-on-white produce maximum-magnitude scores", () => {
    const blackOnWhite = computePerceptualContrast("#000000", "#ffffff");
    const whiteOnBlack = computePerceptualContrast("#ffffff", "#000000");

    expect(blackOnWhite).toBeCloseTo(CONTRAST_SCALE, 2);
    expect(whiteOnBlack).toBeCloseTo(-CONTRAST_SCALE * POLARITY_FACTOR, 2);
    expect(Math.abs(blackOnWhite)).toBeGreaterThan(Math.abs(whiteOnBlack));
  });

  it("T3.3d: negative polarity has smaller magnitude than positive polarity for same |deltaL|", () => {
    const posScore = computePerceptualContrast("#000000", "#ffffff");
    const negScore = computePerceptualContrast("#ffffff", "#000000");

    expect(posScore).toBeGreaterThan(0);
    expect(negScore).toBeLessThan(0);
    expect(Math.abs(negScore)).toBeLessThan(Math.abs(posScore));
    expect(Math.abs(negScore) / Math.abs(posScore)).toBeCloseTo(POLARITY_FACTOR, 3);
  });

  it("T3.4: autoAdjustContrast fixes a deliberately failing pair and reaches contrast >= 75", () => {
    const fgToken = "--tug-element-global-text-normal-default-rest";
    const bgToken = "--tug-surface-global-primary-normal-app-rest";

    const fgL = 0.708 + (38 * (0.96 - 0.708)) / 50;
    const bgL = 0.15 + (15 * (0.708 - 0.15)) / 50;

    const fgResolved: ResolvedColor = { L: fgL, C: 0.02, h: 264, alpha: 1 };
    const bgResolved: ResolvedColor = { L: bgL, C: 0.02, h: 264, alpha: 1 };

    const resolved: Record<string, ResolvedColor> = {
      [fgToken]: fgResolved,
      [bgToken]: bgResolved,
    };
    const tokens: Record<string, string> = {
      [fgToken]: "--tug-color(violet, t: 88)",
      [bgToken]: "--tug-color(violet, t: 15)",
    };

    const initialFgHex = oklchToHex(fgResolved.L, fgResolved.C, fgResolved.h);
    const initialBgHex = oklchToHex(bgResolved.L, bgResolved.C, bgResolved.h);
    const initialLc = computePerceptualContrast(initialFgHex, initialBgHex);
    expect(Math.abs(initialLc)).toBeLessThan(CONTRAST_THRESHOLDS["content"]);

    const failures = [
      {
        fg: fgToken,
        bg: bgToken,
        wcagRatio: computeWcagContrast(initialFgHex, initialBgHex),
        contrast: initialLc,
        contrastPass: false,
        role: "content" as const,
      },
    ];

    const testPairings = [{ element: fgToken, surface: bgToken, role: "content" as const }];
    const result = autoAdjustContrast(tokens, resolved, failures, testPairings);

    expect(result.resolved[bgToken].L).toBeCloseTo(bgResolved.L, 5);
    expect(result.resolved[fgToken].L).toBeGreaterThan(fgResolved.L);

    const newFgHex = oklchToHex(result.resolved[fgToken].L, result.resolved[fgToken].C, result.resolved[fgToken].h);
    const newBgHex = oklchToHex(result.resolved[bgToken].L, result.resolved[bgToken].C, result.resolved[bgToken].h);
    const finalLc = computePerceptualContrast(newFgHex, newBgHex);
    expect(Math.abs(finalLc)).toBeGreaterThanOrEqual(CONTRAST_THRESHOLDS["content"]);
    expect(result.unfixable).toEqual([]);
  });

  it("T3.DEP: autoAdjustContrast (deprecated) is still callable and returns correct shape", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const result = autoAdjustContrast(brioOutput.tokens, brioOutput.resolved, [], []);

    expect(result).toHaveProperty("tokens");
    expect(result).toHaveProperty("resolved");
    expect(result).toHaveProperty("unfixable");
    expect(result.tokens).toEqual(brioOutput.tokens);
    expect(result.unfixable).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test suite: contrast-calibration-baseline
// ---------------------------------------------------------------------------

describe("contrast-calibration-baseline", () => {
  it("CB1: captures all Brio pair contrast scores and verifies baseline structural invariants", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    for (const result of results) {
      expect(typeof result.contrast).toBe("number");
      expect(isFinite(result.contrast)).toBe(true);
    }

    expect(results.length).toBeGreaterThan(50);

    const passes = results.filter((r) => r.contrastPass).length;
    const failures = results.filter((r) => !r.contrastPass).length;
    expect(passes + failures).toBe(results.length);

    const fgDefaultPair = results.find(
      (r) => r.fg === "--tug-element-global-text-normal-default-rest" && r.bg === "--tug-surface-global-primary-normal-app-rest",
    );
    expect(fgDefaultPair).toBeDefined();
    expect(fgDefaultPair!.contrastPass).toBe(true);
  });

  it("CB2: non-zero contrast scores have correct sign relative to OKLab L ordering", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const polarityViolations: string[] = [];

    for (const pairing of ELEMENT_SURFACE_PAIRING_MAP) {
      const fgColor = brioOutput.resolved[pairing.element];
      const bgColor = brioOutput.resolved[pairing.surface];
      if (!fgColor || !bgColor) continue;

      let fgHex: string, bgHex: string;
      if (pairing.parentSurface) {
        const parentColor = brioOutput.resolved[pairing.parentSurface];
        if (!parentColor) continue;
        fgHex = (fgColor.alpha ?? 1.0) < 1.0
          ? compositeOverSurface(fgColor, parentColor)
          : oklchToHex(fgColor.L, fgColor.C, fgColor.h);
        bgHex = (bgColor.alpha ?? 1.0) < 1.0
          ? compositeOverSurface(bgColor, parentColor)
          : oklchToHex(bgColor.L, bgColor.C, bgColor.h);
      } else {
        fgHex = oklchToHex(fgColor.L, fgColor.C, fgColor.h);
        bgHex = oklchToHex(bgColor.L, bgColor.C, bgColor.h);
      }

      const score = computePerceptualContrast(fgHex, bgHex);
      if (score === 0) continue;

      const fgL = hexToOkLabL(fgHex);
      const bgL = hexToOkLabL(bgHex);

      if (score > 0 && bgL <= fgL) {
        polarityViolations.push(`${pairing.element}: score=${score.toFixed(1)} positive but bgL=${bgL.toFixed(3)} <= fgL=${fgL.toFixed(3)}`);
      } else if (score < 0 && bgL >= fgL) {
        polarityViolations.push(`${pairing.element}: score=${score.toFixed(1)} negative but bgL=${bgL.toFixed(3)} >= fgL=${fgL.toFixed(3)}`);
      }
    }

    expect(polarityViolations).toEqual([]);
  });

  it("CB5: fg-default / bg-app anchor pair passes content threshold with calibrated constants", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    const anchorPair = results.find(
      (r) => r.fg === "--tug-element-global-text-normal-default-rest" && r.bg === "--tug-surface-global-primary-normal-app-rest",
    );
    expect(anchorPair).toBeDefined();
    expect(anchorPair!.contrastPass).toBe(true);
    expect(Math.abs(anchorPair!.contrast)).toBeGreaterThan(CONTRAST_THRESHOLDS["content"]);
  });

  it("CB6: OKLab metric produces a sensible, self-consistent pass/fail distribution for all Brio pairs", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    // Internal consistency: contrastPass flag must match score vs threshold
    const internalInconsistencies: string[] = [];
    for (const r of results) {
      const threshold = (CONTRAST_THRESHOLDS as Record<string, number>)[r.role] ?? 15;
      if (r.contrastPass && Math.abs(r.contrast) < threshold) {
        internalInconsistencies.push(`${r.fg} on ${r.bg}: contrastPass=true but |contrast|=${Math.abs(r.contrast).toFixed(1)} < threshold=${threshold}`);
      }
      if (!r.contrastPass && Math.abs(r.contrast) >= threshold) {
        internalInconsistencies.push(`${r.fg} on ${r.bg}: contrastPass=false but |contrast|=${Math.abs(r.contrast).toFixed(1)} >= threshold=${threshold}`);
      }
    }
    expect(internalInconsistencies).toEqual([]);

    // Reasonable overall pass count
    const passingCount = results.filter((r) => r.contrastPass).length;
    expect(passingCount).toBeGreaterThanOrEqual(140);

    // content and control must have passing entries
    const passingRoles = new Set(results.filter((r) => r.contrastPass).map((r) => r.role));
    expect(passingRoles.has("content")).toBe(true);
    expect(passingRoles.has("control")).toBe(true);
  });
});
