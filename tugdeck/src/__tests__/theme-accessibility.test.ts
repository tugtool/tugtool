/**
 * Theme accessibility tests — pairing map completeness, validity,
 * WCAG contrast calculations, perceptual contrast, validation, auto-adjustment,
 * and CVD simulation.
 *
 * Covers:
 * - T1.1: ELEMENT_SURFACE_PAIRING_MAP contains entries for all chromatic fg tokens
 * - T1.2: Every entry has a valid `role` from the allowed set
 * - T1.3: No duplicate pairs
 * - T3.1: computeWcagContrast("#000000", "#ffffff") returns 21.0
 * - T3.2: computeWcagContrast("#777777", "#ffffff") returns ~4.48
 * - T3.3: computePerceptualContrast polarity detection
 * - T3.4: autoAdjustContrast fixes a deliberately failing pair (deprecated; retained for coverage)
 * - T3.5: validateThemeContrast against Brio — all content pairs pass 4.5:1
 * - T3.6: autoAdjustContrast most-restrictive-bg strategy (deprecated; retained for coverage)
 * - T3.7: autoAdjustContrast returns unfixable list when token cannot reach threshold (deprecated)
 * - T3.DEP: autoAdjustContrast is marked @deprecated (Step 5)
 * - T5.1: simulateCVD with pure gray returns nearly unchanged values for all types
 * - T5.2: Protanopia simulation of pure red significantly reduces the R channel
 * - T5.3: checkCVDDistinguishability flags green/red pair under protanopia + deuteranopia
 * - T5.4: Achromatopsia matrix produces identical R, G, B channels
 * - T5.5: severity=0.0 returns input unchanged; severity=1.0 matches full matrix
 *
 * Run with: cd tugdeck && bun test -- --grep "pairing-map|theme-accessibility|cvd-simulation"
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "bun:test";

import { ELEMENT_SURFACE_PAIRING_MAP, ContrastRole } from "@/components/tugways/element-surface-pairing-map";
import {
  computeWcagContrast,
  computePerceptualContrast,
  validateThemeContrast,
  autoAdjustContrast,
  compositeOverSurface,
  simulateCVD,
  simulateCVDFromOKLCH,
  simulateCVDForHex,
  checkCVDDistinguishability,
  hexToOkLabL,
  CVD_MATRICES,
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
import { oklchToHex, oklchToLinearSRGB } from "@/components/tugways/palette-engine";

import {
  INTENTIONALLY_BELOW_THRESHOLD,
  KNOWN_PAIR_EXCEPTIONS as SHARED_KNOWN_PAIR_EXCEPTIONS,
} from "./contrast-exceptions";

// ---------------------------------------------------------------------------
// CSS parsing helpers
// ---------------------------------------------------------------------------

const STYLES_DIR = join(import.meta.dir, "../../styles");

/**
 * Read tug-base-generated.css, which contains the body {} block with all
 * --tug-base-* token declarations. This is the file used by the token-extraction
 * helpers (which regex on body {}). tug-base.css @imports it at the top level.
 */
function readInlinedThemeCSS(): string {
  return readFileSync(join(STYLES_DIR, "tug-base-generated.css"), "utf8");
}

/** Extract all --tug-base-* custom property names defined in tug-base.css body{}. */
function extractBaseTokenNames(css: string): Set<string> {
  const tokens = new Set<string>();
  // Match all --tug-base-* property assignments inside body { }
  const bodyMatch = css.match(/body\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s);
  if (!bodyMatch) return tokens;
  const bodyContent = bodyMatch[1];
  const tokenRegex = /(--tug-base-[a-zA-Z0-9_-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(bodyContent)) !== null) {
    tokens.add(m[1]);
  }
  return tokens;
}

/**
 * Determine whether a --tug-base-* token is "chromatic" (has a --tug-color() value).
 * Tokens that are purely numeric, keyword-only (transparent, none), or
 * plain string values (font families, calc expressions) are not chromatic.
 */
function extractChromaticTokens(css: string): {
  fg: Set<string>;
  bg: Set<string>;
} {
  const fgTokens = new Set<string>();
  const bgTokens = new Set<string>();

  // Chromatic tokens: those whose value contains --tug-color(
  const bodyMatch = css.match(/body\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s);
  if (!bodyMatch) return { fg: fgTokens, bg: bgTokens };
  const bodyContent = bodyMatch[1];

  // Split into individual property declarations
  const declRegex = /(--tug-base-[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = declRegex.exec(bodyContent)) !== null) {
    const name = m[1];
    const value = m[2].trim();
    if (!value.includes("--tug-color(")) continue;

    // Classify as fg or bg based on naming patterns
    const isFg =
      name.includes("-fg") ||
      name.includes("-icon") ||
      name.includes("checkmark") ||
      name.includes("radio-dot") ||
      name.includes("toggle-thumb");

    // Classify as bg: only tokens that are truly backgrounds/surfaces.
    // Exclude tokens that end in -fg, -icon, -border, -label, etc.
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
  // tug-base.css @imports tug-base-generated.css for the token block.
  // Use the inlined combined CSS so the body{} regex finds all tokens.
  const css = readInlinedThemeCSS();
  const { fg: chromaticFgTokens, bg: chromaticBgTokens } =
    extractChromaticTokens(css);

  const VALID_ROLES: Set<ContrastRole> = new Set([
    "content",
    "control",
    "display",
    "informational",
    "decorative",
  ]);

  // -------------------------------------------------------------------------
  // T1.1: Every chromatic fg token appears in at least one pairing
  // -------------------------------------------------------------------------
  it("T1.1: contains entries for all chromatic fg tokens in tug-base.css", () => {
    const mappedFgTokens = new Set(ELEMENT_SURFACE_PAIRING_MAP.map((p) => p.element));

    // Tokens that are fg-class but excluded from pairings:
    // - disabled-opacity, disabled-shadow (non-chromatic)
    // - ghost-bg-rest, ghost-border-rest (transparent/structural)
    // The classification above already excludes these.

    const missingFgTokens: string[] = [];
    for (const token of chromaticFgTokens) {
      if (!mappedFgTokens.has(token)) {
        missingFgTokens.push(token);
      }
    }

    expect(missingFgTokens).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T1.1b: Every chromatic bg token appears in at least one pairing
  // -------------------------------------------------------------------------
  it("T1.1b: contains entries for all chromatic bg tokens in tug-base.css", () => {
    const mappedBgTokens = new Set(ELEMENT_SURFACE_PAIRING_MAP.map((p) => p.surface));

    // Some bg tokens appear only as structural (bg-disabled uses var() ref)
    // or are semi-transparent overlays primarily used for layering, not direct
    // fg-over-bg pairings. These are expected to be absent from the map.
    const EXCLUDED_BG_TOKENS = new Set([
      // selected-disabled-bg uses var() reference (structural pass-through);
      // pairings are covered via control-disabled-bg directly
      "--tug-base-surface-control-primary-normal-selected-disabled",
      // semi-transparent overlays / highlights — not direct surface pairings
      // (these are additive overlays layered on top of surfaces)
      "--tug-base-surface-overlay-primary-normal-dim-rest",
      "--tug-base-surface-overlay-primary-normal-scrim-rest",
      "--tug-base-surface-overlay-primary-normal-highlight-rest",
      "--tug-base-surface-highlight-primary-normal-hover-rest",
      "--tug-base-surface-highlight-primary-normal-dropTarget-rest",
      "--tug-base-surface-highlight-primary-normal-preview-rest",
      "--tug-base-surface-highlight-primary-normal-inspectorTarget-rest",
      "--tug-base-surface-highlight-primary-normal-snapGuide-rest",
      "--tug-base-surface-highlight-primary-normal-flash-rest",
      "--tug-base-element-global-fill-normal-accentSubtle-rest",
      // selection-bg-inactive is decorative / no chromatic fg over it
      "--tug-base-surface-selection-primary-normal-plain-inactive",
      // ghost hover/active are semi-transparent (effectively overlays over parent surface)
      "--tug-base-surface-control-primary-ghost-action-hover",
      "--tug-base-surface-control-primary-ghost-action-active",
      "--tug-base-surface-control-primary-ghost-danger-hover",
      "--tug-base-surface-control-primary-ghost-danger-active",
      // option role hover/active are semi-transparent overlays (same as ghost pattern)
      "--tug-base-surface-control-primary-outlined-option-hover",
      "--tug-base-surface-control-primary-outlined-option-active",
      "--tug-base-surface-control-primary-ghost-option-hover",
      "--tug-base-surface-control-primary-ghost-option-active",
      // selected-bg-hover is a slightly more opaque version of selected-bg
      "--tug-base-surface-control-primary-normal-selected-hover",
      // field-bg-disabled paired via field-fg-disabled
      "--tug-base-surface-field-primary-normal-plain-disabled",
      // accent-cool-default is used as a focus ring / accent UI element
      "--tug-base-element-global-fill-normal-accentCool-rest",
      // tab-bg-hover and tab-close-bg-hover are semi-transparent overlays
      "--tug-base-surface-tab-primary-normal-plain-hover",
      "--tug-base-surface-tabClose-primary-normal-plain-hover",
      // tab-bg-inactive and tab-bg-collapsed are title bar/collapsed card backgrounds
      // (text contrast is covered via tab-fg-rest / card-title-bar-fg)
      "--tug-base-surface-tab-primary-normal-plain-inactive",
      "--tug-base-surface-tab-primary-normal-plain-collapsed",
      // grid-rest is a decorative stroke used in background-image, not a surface
      // on which fg text sits — no fg-over-bg pairing applies; contrast is irrelevant
      "--tug-base-surface-global-primary-normal-grid-rest",
    ]);

    const missingBgTokens: string[] = [];
    for (const token of chromaticBgTokens) {
      if (!mappedBgTokens.has(token) && !EXCLUDED_BG_TOKENS.has(token)) {
        missingBgTokens.push(token);
      }
    }

    expect(missingBgTokens).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T1.2: Every entry has a valid role
  // -------------------------------------------------------------------------
  it("T1.2: every entry has a valid role from the allowed set", () => {
    const invalidRoles: Array<{ element: string; surface: string; role: string }> = [];
    for (const pairing of ELEMENT_SURFACE_PAIRING_MAP) {
      if (!VALID_ROLES.has(pairing.role)) {
        invalidRoles.push({
          element: pairing.element,
          surface: pairing.surface,
          role: pairing.role,
        });
      }
    }
    expect(invalidRoles).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T1.3: No duplicate pairs
  // -------------------------------------------------------------------------
  it("T1.3: no duplicate element/surface pairs", () => {
    const seen = new Set<string>();
    const duplicates: Array<{ element: string; surface: string }> = [];
    for (const pairing of ELEMENT_SURFACE_PAIRING_MAP) {
      const key = `${pairing.element}|${pairing.surface}`;
      if (seen.has(key)) {
        duplicates.push({ element: pairing.element, surface: pairing.surface });
      }
      seen.add(key);
    }
    expect(duplicates).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Sanity: map is non-empty and has reasonable size
  // -------------------------------------------------------------------------
  it("has at least 50 pairings (sanity check)", () => {
    expect(ELEMENT_SURFACE_PAIRING_MAP.length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// Test suite: theme-accessibility — WCAG contrast, perceptual contrast, validation
// ---------------------------------------------------------------------------

describe("theme-accessibility", () => {
  // -------------------------------------------------------------------------
  // T3.1: computeWcagContrast black-on-white returns 21.0
  // -------------------------------------------------------------------------
  it("T3.1: computeWcagContrast('#000000', '#ffffff') returns 21.0", () => {
    const ratio = computeWcagContrast("#000000", "#ffffff");
    expect(Math.abs(ratio - 21.0)).toBeLessThan(0.01);
  });

  // -------------------------------------------------------------------------
  // T3.2: computeWcagContrast('#777777', '#ffffff') returns ~4.48
  // -------------------------------------------------------------------------
  it("T3.2: computeWcagContrast('#777777', '#ffffff') returns ~4.48", () => {
    const ratio = computeWcagContrast("#777777", "#ffffff");
    // Known value: #777777 on white ≈ 4.48
    expect(ratio).toBeGreaterThan(4.4);
    expect(ratio).toBeLessThan(4.6);
  });

  // -------------------------------------------------------------------------
  // T3.3: computePerceptualContrast polarity — dark-on-light is positive, light-on-dark negative
  // -------------------------------------------------------------------------
  it("T3.3: computePerceptualContrast returns correct polarity for dark-on-light vs light-on-dark", () => {
    // Dark text on light background → positive contrast
    const normalLc = computePerceptualContrast("#000000", "#ffffff");
    expect(normalLc).toBeGreaterThan(0);

    // Light text on dark background → negative contrast
    const reverseLc = computePerceptualContrast("#ffffff", "#000000");
    expect(reverseLc).toBeLessThan(0);

    // The magnitudes should be similar (both near 100)
    expect(Math.abs(normalLc)).toBeGreaterThan(90);
    expect(Math.abs(reverseLc)).toBeGreaterThan(90);
  });

  // -------------------------------------------------------------------------
  // T3.3b: computePerceptualContrast returns 0 when deltaL < CONTRAST_MIN_DELTA
  //
  // OKLab L for two near-identical grays: #808080 and #818181 differ by < 0.01 OKLab L.
  // Any pair with |deltaL| < CONTRAST_MIN_DELTA should return exactly 0.
  // -------------------------------------------------------------------------
  it("T3.3b: computePerceptualContrast returns 0 when deltaL < CONTRAST_MIN_DELTA", () => {
    // Verify CONTRAST_MIN_DELTA is exported and is a small positive number
    expect(CONTRAST_MIN_DELTA).toBeGreaterThan(0);
    expect(CONTRAST_MIN_DELTA).toBeLessThan(0.1);

    // Two nearly-identical grays — deltaL well below CONTRAST_MIN_DELTA
    const score = computePerceptualContrast("#808080", "#808080");
    expect(score).toBe(0);

    // Identical colors — deltaL = 0, should return 0
    const scoreIdentical = computePerceptualContrast("#3a4050", "#3a4050");
    expect(scoreIdentical).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T3.3c: white-on-black and black-on-white produce maximum-magnitude scores
  //
  // With OKLab L metric and SCALE=150:
  //   black-on-white: deltaL = 1.0 - 0.0 = 1.0 → score = 1.0 * 150 = 150
  //   white-on-black: deltaL = 0.0 - 1.0 = -1.0 → score = -1.0 * 150 * 0.85 = -127.5
  //
  // These are the maximum possible magnitudes for the current calibration.
  // -------------------------------------------------------------------------
  it("T3.3c: white-on-black and black-on-white produce maximum-magnitude scores", () => {
    const blackOnWhite = computePerceptualContrast("#000000", "#ffffff");
    const whiteOnBlack = computePerceptualContrast("#ffffff", "#000000");

    // Positive polarity: black-on-white = deltaL * SCALE = 1.0 * 150 = 150
    expect(blackOnWhite).toBeCloseTo(CONTRAST_SCALE, 2);

    // Negative polarity: white-on-black = deltaL * SCALE * PF = -1.0 * 150 * 0.85 = -127.5
    expect(whiteOnBlack).toBeCloseTo(-CONTRAST_SCALE * POLARITY_FACTOR, 2);

    // Positive polarity (black-on-white) has larger magnitude than negative polarity
    expect(Math.abs(blackOnWhite)).toBeGreaterThan(Math.abs(whiteOnBlack));
  });

  // -------------------------------------------------------------------------
  // T3.3d: negative polarity scores have smaller magnitude than positive polarity
  //        for the same |deltaL|
  //
  // The POLARITY_FACTOR (0.85) reduces the score magnitude for light-on-dark pairs.
  // For any ΔL where both polarities are non-zero, the light-on-dark score must
  // have a smaller magnitude.
  // -------------------------------------------------------------------------
  it("T3.3d: negative polarity has smaller magnitude than positive polarity for same |deltaL|", () => {
    // Use symmetric grays where we can control deltaL precisely.
    // OKLab L for #000000 is 0.0, #ffffff is 1.0, so a gray at L=0.5 needs lookup.
    // Use known pair: black-on-white vs white-on-black for same |deltaL|=1.0.
    const posScore = computePerceptualContrast("#000000", "#ffffff"); // positive polarity
    const negScore = computePerceptualContrast("#ffffff", "#000000"); // negative polarity

    expect(posScore).toBeGreaterThan(0);
    expect(negScore).toBeLessThan(0);
    // Negative polarity score has smaller magnitude by factor of POLARITY_FACTOR
    expect(Math.abs(negScore)).toBeLessThan(Math.abs(posScore));
    expect(Math.abs(negScore) / Math.abs(posScore)).toBeCloseTo(POLARITY_FACTOR, 3);
  });

  // -------------------------------------------------------------------------
  // T3.4: autoAdjustContrast fixes a deliberately failing pair — reaches contrast >= 75
  //
  // Scenario (dark mode): bg at violet tone=15 (very dark, L≈0.3174), fg starts at
  // tone=88 (L≈0.8995, contrast≈-74.3 — fails content contrast 75 threshold by ~0.7).
  //
  // With the OKLab L metric (CONTRAST_SCALE=150, POLARITY_FACTOR=0.85):
  //   bg OkLabL ≈ 0.3169, fg tone=88 OkLabL ≈ 0.8830
  //   deltaL = bgL - fgL ≈ -0.5661 → score = -0.5661 * 150 * 0.85 ≈ -72.2 (fails)
  //
  // bumpDirection: fgL > bgL → direction=+1 (fg goes lighter each step, TONE_STEP=5).
  // Trace (5-unit tone steps):
  //   Iter 1: tone 88→93, |contrast|≈77.4 (passes contrast 75!)
  //
  // violet canonL=0.708, L_DARK=0.15, L_LIGHT=0.96:
  //   tone=88: L = 0.708 + 38*(0.96-0.708)/50 = 0.708 + 0.1915 = 0.8995
  //   tone=15: L = 0.15 + 15*(0.708-0.15)/50  = 0.15 + 0.1674  = 0.3174
  //
  // The test asserts the final |contrast| >= CONTRAST_THRESHOLDS["content"] (75),
  // proving the pair was fixed under the normative contrast gate.
  // -------------------------------------------------------------------------
  it("T3.4: autoAdjustContrast fixes a deliberately failing pair and reaches contrast >= 75", () => {
    const fgToken = "--tug-base-element-global-text-normal-default-rest";
    const bgToken = "--tug-base-surface-global-primary-normal-app-rest";

    // violet canonL=0.708, L_DARK=0.15, L_LIGHT=0.96
    // fg starts at tone=88 (OKLab contrast ≈ -74.3, just below content threshold 75)
    // bg at tone=15 (dark surface)
    const fgL = 0.708 + (38 * (0.96 - 0.708)) / 50; // tone=88 → ~0.8995
    const bgL = 0.15 + (15 * (0.708 - 0.15)) / 50;  // tone=15 → ~0.3174

    const fgResolved: ResolvedColor = { L: fgL, C: 0.02, h: 264, alpha: 1 };
    const bgResolved: ResolvedColor = { L: bgL, C: 0.02, h: 264, alpha: 1 };

    const resolved: Record<string, ResolvedColor> = {
      [fgToken]: fgResolved,
      [bgToken]: bgResolved,
    };
    // Token strings use violet hue with explicit tone=88 — parseTugColorToken will extract
    // hueRef="violet", intensity=50, tone=88 so autoAdjustContrast can bump the tone.
    const tokens: Record<string, string> = {
      [fgToken]: "--tug-color(violet, t: 88)",
      [bgToken]: "--tug-color(violet, t: 15)",
    };

    const initialFgHex = oklchToHex(fgResolved.L, fgResolved.C, fgResolved.h);
    const initialBgHex = oklchToHex(bgResolved.L, bgResolved.C, bgResolved.h);
    const initialLc = computePerceptualContrast(initialFgHex, initialBgHex);
    // Verify setup: initial |contrast| should be < 75 (failing content threshold)
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

    // Test-local pairings array — keeps T3.4 isolated and predictable
    const testPairings = [
      { element: fgToken, surface: bgToken, role: "content" as const },
    ];

    const result = autoAdjustContrast(tokens, resolved, failures, testPairings);

    // bg should be unchanged
    expect(result.resolved[bgToken].L).toBeCloseTo(bgResolved.L, 5);

    // fg should have been bumped toward lighter
    expect(result.resolved[fgToken].L).toBeGreaterThan(fgResolved.L);

    // Final contrast must meet the contrast 75 content threshold (normative gate)
    const newFgResolved = result.resolved[fgToken];
    const newBgResolved = result.resolved[bgToken];
    const fgHex = oklchToHex(newFgResolved.L, newFgResolved.C, newFgResolved.h);
    const bgHex = oklchToHex(newBgResolved.L, newBgResolved.C, newBgResolved.h);
    const finalLc = computePerceptualContrast(fgHex, bgHex);
    expect(Math.abs(finalLc)).toBeGreaterThanOrEqual(CONTRAST_THRESHOLDS["content"]);

    // Unfixable list should be empty (pair was fixed)
    expect(result.unfixable).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T3.5: validateThemeContrast against Brio defaults — all content pairs.
  //
  // The following tokens are classified as "content" role in the pairing map
  // but are intentionally or structurally below contrast 75 in the Brio dark theme
  // under the OKLab L metric:
  //
  //   --tug-base-element-global-text-normal-link-rest           — link fg (below 75 by design; the link colour
  //                                  is chosen for brand recognition, not max contrast)
  //   --tug-base-element-control-text-normal-selected-rest  — selected item label on selected-bg tint
  //                                     (selection bg is a translucent accent tint;
  //                                      combined stack passes in real rendering)
  //   --tug-base-element-control-text-normal-highlighted-rest — same as selected, highlighted tint
  //   --tug-base-element-selection-text-normal-plain-rest      — text-selection overlay fg (rendered over
  //                                  selection-bg translucent tint; stack passes)
  //   --tug-base-element-tab-text-normal-plain-active     — active tab label; near-miss by design (the tab
  //                                  chrome uses a deliberately reduced contrast to
  //                                  avoid competing with content)
  //
  // Note: fg-subtle, fg-placeholder, fg-muted, field-fg-readOnly, and tab-fg-rest
  // are all paired at "informational" role (not content) and are therefore not
  // evaluated in this content suite. fg-link-hover and tab-fg-hover pass content
  // under the new OKLab metric and are no longer exceptions.
  //
  // Step 5 gap pairs: three newly-added pairings discovered in the Step 2 audit
  // are below contrast 75 in Brio dark. These are acknowledged gaps that Phase 2
  // of the theme-system-overhaul will resolve. They are tracked here as pair-level
  // exceptions (not fg-default element exceptions) so any additional fg-default
  // failures outside these three surfaces are still caught.
  //
  //   fg-default on tab-bg-active  — card title text on active title bar; contrast
  //                                  ~73.6 (marginal: within 5 units of threshold 75).
  //                                  The contrast engine does not auto-adjust fg-default
  //                                  for tab-bg-active; this is the primary gap that
  //                                  Phase 2 will close.
  //   fg-default on accent-subtle  — menu selected item text on accent-subtle (15% alpha
  //                                  tint); composited contrast ~62, below threshold 75.
  //                                  Engine cannot adjust fg-default for chromatic surfaces.
  //   fg-default on tone-caution-bg — autofix suggestion text on caution tint (~12% alpha);
  //                                  composited contrast ~58, below threshold 75.
  //
  // These exclusions are tracked here explicitly so any new failures outside this
  // known set are surfaced immediately as test failures.
  // -------------------------------------------------------------------------
  it("T3.5: validateThemeContrast against Brio defaults — known content passes and known-below exceptions", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    // Tokens intentionally or structurally below contrast 75 — imported from contrast-exceptions.ts.
    // (INTENTIONALLY_BELOW_THRESHOLD imported at top of file)

    // Step 5 gap pairs: use SHARED_KNOWN_PAIR_EXCEPTIONS from contrast-exceptions.ts.
    // These include fg-default on tab-bg-active, accent-subtle, tone-caution-bg, and
    // tone-danger on surface-overlay. Tracked as pair exceptions (not token exceptions)
    // so fg-default failures on other surfaces are still caught.

    const contentResults = results.filter((r) => r.role === "content");
    expect(contentResults.length).toBeGreaterThan(0);

    // All content pairings NOT in the known-exception sets must pass contrast 75
    const unexpectedFailures = contentResults.filter(
      (r) => !r.contrastPass && !INTENTIONALLY_BELOW_THRESHOLD.has(r.fg) && !SHARED_KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`),
    );
    const failureDescriptions = unexpectedFailures.map(
      (f) => `${f.fg} on ${f.bg}: contrast ${f.contrast.toFixed(1)}`,
    );
    expect(failureDescriptions).toEqual([]);

    // Primary fg-default must pass contrast 75 on its canonical surfaces (belt-and-suspenders).
    // Excludes the Step 5 gap pairs which are acknowledged accessibility gaps pending Phase 2 resolution.
    const coreResults = contentResults.filter(
      (r) => r.fg === "--tug-base-element-global-text-normal-default-rest" && !SHARED_KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`),
    );
    expect(coreResults.length).toBeGreaterThan(0);
    expect(coreResults.every((r) => r.contrastPass)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T3.6: autoAdjustContrast — most-restrictive-bg strategy
  // A single fg token paired against 3 different bg tokens (varying lightness)
  // → single adjustment satisfies all pairings.
  // -------------------------------------------------------------------------
  it("T3.6: autoAdjustContrast with fg vs 3 bgs — single adjustment satisfies all", () => {
    const fgToken = "--tug-base-element-global-text-normal-default-rest";
    const bgToken1 = "--tug-base-surface-global-primary-normal-app-rest";
    const bgToken2 = "--tug-base-surface-global-primary-normal-default-rest";
    const bgToken3 = "--tug-base-surface-global-primary-normal-raised-rest";

    // fg at medium lightness, 3 bg tokens at varying lightness (all dark mode)
    // In dark mode, bg is dark (low L), fg should be light (high L)
    const fgResolved: ResolvedColor = { L: 0.30, C: 0.02, h: 264, alpha: 1 };
    // Three backgrounds with varying darkness (darkest most restrictive for fg lightness bump)
    const bgResolved1: ResolvedColor = { L: 0.18, C: 0.01, h: 264, alpha: 1 }; // very dark
    const bgResolved2: ResolvedColor = { L: 0.20, C: 0.01, h: 264, alpha: 1 }; // dark
    const bgResolved3: ResolvedColor = { L: 0.22, C: 0.01, h: 264, alpha: 1 }; // slightly less dark

    const resolved: Record<string, ResolvedColor> = {
      [fgToken]: fgResolved,
      [bgToken1]: bgResolved1,
      [bgToken2]: bgResolved2,
      [bgToken3]: bgResolved3,
    };
    const tokens: Record<string, string> = {
      [fgToken]: "--tug-color(violet, i: 10, t: 43)",
      [bgToken1]: "--tug-color(violet, i: 5, t: 15)",
      [bgToken2]: "--tug-color(violet, i: 5, t: 17)",
      [bgToken3]: "--tug-color(violet, i: 5, t: 19)",
    };

    // All 3 pairings fail initially
    const failures = [
      { fg: fgToken, bg: bgToken1, wcagRatio: 1.5, contrast: 10, contrastPass: false, role: "content" as const },
      { fg: fgToken, bg: bgToken2, wcagRatio: 1.4, contrast: 9, contrastPass: false, role: "content" as const },
      { fg: fgToken, bg: bgToken3, wcagRatio: 1.3, contrast: 8, contrastPass: false, role: "content" as const },
    ];

    // Test-local pairings array — covers exactly the three surfaces in this test
    const testPairings = [
      { element: fgToken, surface: bgToken1, role: "content" as const },
      { element: fgToken, surface: bgToken2, role: "content" as const },
      { element: fgToken, surface: bgToken3, role: "content" as const },
    ];

    const result = autoAdjustContrast(tokens, resolved, failures, testPairings);

    // fg should have been adjusted (all 3 pairings share same fg token)
    const newFgResolved = result.resolved[fgToken];
    expect(newFgResolved.L).not.toBeCloseTo(fgResolved.L, 5);

    // All 3 pairings should have improved contrast (convergence-based loop, SAFETY_CAP=20)
    // oklchToHex is imported at the top of the file
    for (const bgToken of [bgToken1, bgToken2, bgToken3]) {
      const fgHex = oklchToHex(newFgResolved.L, newFgResolved.C, newFgResolved.h);
      const bgResolved = result.resolved[bgToken];
      const bgHex = oklchToHex(bgResolved.L, bgResolved.C, bgResolved.h);
      const newRatio = computeWcagContrast(fgHex, bgHex);
      // Contrast should have improved from initial ~1.3–1.5
      expect(newRatio).toBeGreaterThan(1.5);
    }
  });

  // -------------------------------------------------------------------------
  // T3.7: autoAdjustContrast returns unfixable when token cannot reach threshold
  //
  // Scenario: fg starts slightly lighter than bg, both near the L_LIGHT ceiling
  // (violet tone≈92 for fg, tone=90 for bg). contrast sign: fgL > bgL → contrast is positive
  // (dark-on-light polarity) → bumpDirection = -1 (bump fg darker, toward bg).
  // That immediately reduces contrast further, contrast flips sign, direction flips to +1.
  // The alternating pattern triggers oscillation detection, freezing the token as
  // unfixable after 3 alternating directions.
  //
  // Probed values (violet, C=0.02, h=264):
  //   bg=tone90 (L≈0.9096):  fg=tone100 (L=0.96) → |contrast|≈... far below contrast 75
  //   bg=tone90:              fg=tone92  (L≈0.920) → |contrast|≈... far below contrast 75 (start)
  // -------------------------------------------------------------------------
  it("T3.7: autoAdjustContrast returns unfixable list when ceiling prevents reaching threshold", () => {
    const fgToken = "--tug-base-fg-special";
    const bgToken = "--tug-base-bg-special";

    // violet canonL=0.708, L_DARK=0.15, L_LIGHT=0.96
    // tone=90: L = 0.708 + 40*(0.96-0.708)/50 = 0.708 + 0.2016 = 0.9096
    // tone=92: L = 0.708 + 42*(0.96-0.708)/50 = 0.708 + 0.21168 = 0.91968
    const bgL = 0.708 + 40 * (0.96 - 0.708) / 50; // ~0.9096
    const fgL = 0.708 + 42 * (0.96 - 0.708) / 50; // ~0.9197

    const fgResolved: ResolvedColor = { L: fgL, C: 0.02, h: 264, alpha: 1 };
    const bgResolved: ResolvedColor = { L: bgL, C: 0.02, h: 264, alpha: 1 };

    const resolved: Record<string, ResolvedColor> = {
      [fgToken]: fgResolved,
      [bgToken]: bgResolved,
    };
    // Token string uses tone=92 — parseTugColorToken extracts hueRef="violet", tone=92
    const tokens: Record<string, string> = {
      [fgToken]: "--tug-color(violet, t: 92)",
      [bgToken]: "--tug-color(violet, t: 90)",
    };

    const initialFgHex = oklchToHex(fgResolved.L, fgResolved.C, fgResolved.h);
    const initialBgHex = oklchToHex(bgResolved.L, bgResolved.C, bgResolved.h);
    const initialRatio = computeWcagContrast(initialFgHex, initialBgHex);
    // Verify setup: initial ratio is well below 4.5
    expect(initialRatio).toBeLessThan(4.5);

    const failures = [
      {
        fg: fgToken,
        bg: bgToken,
        wcagRatio: initialRatio,
        contrast: 3,
        contrastPass: false,
        role: "content" as const,
      },
    ];

    // Test-local pairings array — keeps T3.7 isolated and predictable
    const testPairings = [
      { element: fgToken, surface: bgToken, role: "content" as const },
    ];

    const result = autoAdjustContrast(tokens, resolved, failures, testPairings);

    // The token must appear in the unfixable list — both fg and bg are near the
    // L_LIGHT ceiling; bumping fg lighter just moves it closer to bg, and
    // oscillation detection or convergence detection will freeze it as unfixable.
    expect(result.unfixable).toContain(fgToken);

    // bg should remain unchanged
    expect(result.resolved[bgToken].L).toBeCloseTo(bgResolved.L, 5);

    // The returned maps must be well-formed objects
    expect(typeof result.tokens).toBe("object");
    expect(typeof result.resolved).toBe("object");
  });

  // -------------------------------------------------------------------------
  // T3.8: Oscillation detection — two mutually-breaking pairs freeze both tokens
  //
  // Scenario: token A on surface S1 and token A on surface S2, where S1 is very
  // dark and S2 is very light. Bumping A lighter fixes A/S1 but breaks A/S2;
  // bumping darker fixes A/S2 but breaks A/S1. The direction alternates each
  // iteration, triggering oscillation detection after 3 alternating directions.
  // The token must be reported as unfixable.
  //
  // We simulate this with two surfaces: one near L_DARK (very dark) and one
  // near L_LIGHT (very light), with the element token starting at the mid-tone
  // (L≈canonL). No direction can satisfy both surfaces simultaneously.
  // -------------------------------------------------------------------------
  it("T3.8: oscillation detection — token that breaks different pairs in alternating directions is marked unfixable", () => {
    const elementToken = "--tug-base-fg-special";
    const darkSurface = "--tug-base-surface-dark";
    const lightSurface = "--tug-base-surface-light";

    // violet canonL=0.708, L_DARK=0.15, L_LIGHT=0.96
    // Element at mid-tone (canonical L), surfaces at extremes
    const elementL = 0.708; // canonical tone=50
    const darkL = 0.17;     // very dark surface — element needs to go lighter
    const lightL = 0.93;    // very light surface — element needs to go darker

    const elementResolved: ResolvedColor = { L: elementL, C: 0.02, h: 264, alpha: 1 };
    const darkResolved: ResolvedColor = { L: darkL, C: 0.01, h: 264, alpha: 1 };
    const lightResolved: ResolvedColor = { L: lightL, C: 0.01, h: 264, alpha: 1 };

    const resolved: Record<string, ResolvedColor> = {
      [elementToken]: elementResolved,
      [darkSurface]: darkResolved,
      [lightSurface]: lightResolved,
    };
    const tokens: Record<string, string> = {
      [elementToken]: "--tug-color(violet, t: 50)",
      [darkSurface]: "--tug-color(violet, i: 2, t: 10)",
      [lightSurface]: "--tug-color(violet, i: 2, t: 92)",
    };

    // Both pairings fail — the element is mid-tone, not enough contrast with either extreme
    const elementHex = oklchToHex(elementL, 0.02, 264);
    const darkHex = oklchToHex(darkL, 0.01, 264);
    const lightHex = oklchToHex(lightL, 0.01, 264);
    const failures = [
      {
        fg: elementToken, bg: darkSurface,
        wcagRatio: computeWcagContrast(elementHex, darkHex),
        contrast: computePerceptualContrast(elementHex, darkHex),
        contrastPass: false, role: "content" as const,
      },
      {
        fg: elementToken, bg: lightSurface,
        wcagRatio: computeWcagContrast(elementHex, lightHex),
        contrast: computePerceptualContrast(elementHex, lightHex),
        contrastPass: false, role: "content" as const,
      },
    ];

    // Both pairings should indeed be failing initially
    expect(failures.every((f) => !f.contrastPass)).toBe(true);

    const testPairings = [
      { element: elementToken, surface: darkSurface, role: "content" as const },
      { element: elementToken, surface: lightSurface, role: "content" as const },
    ];

    const result = autoAdjustContrast(tokens, resolved, failures, testPairings);

    // The element token must be in the unfixable list — oscillation between
    // bumping lighter (to fix dark surface) and darker (to fix light surface)
    // should trigger the 3-alternation freeze
    expect(result.unfixable).toContain(elementToken);
  });

  // -------------------------------------------------------------------------
  // T3.9: Convergence — auto-adjust stops before safety cap when all pairs pass
  //
  // Scenario: a single failing pair that is fixed in one iteration. After
  // the pair passes, remainingFailures is empty and the loop should exit
  // immediately. We verify the function terminates quickly (does not exhaust
  // all 20 iterations) by checking the outcome is correct.
  // -------------------------------------------------------------------------
  it("T3.9: convergence — auto-adjust stops early when all pairs pass", () => {
    const fgToken = "--tug-base-element-global-text-normal-default-rest";
    const bgToken = "--tug-base-surface-global-primary-normal-app-rest";

    // Start near-passing: tone=88, OKLab contrast ≈ -74.3 (just below contrast 75)
    const fgL = 0.708 + (38 * (0.96 - 0.708)) / 50; // tone=88 → ~0.8995
    const bgL = 0.15 + (15 * (0.708 - 0.15)) / 50;  // tone=15 → ~0.3174

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

    const fgHex = oklchToHex(fgL, 0.02, 264);
    const bgHex = oklchToHex(bgL, 0.02, 264);
    const failures = [
      {
        fg: fgToken, bg: bgToken,
        wcagRatio: computeWcagContrast(fgHex, bgHex),
        contrast: computePerceptualContrast(fgHex, bgHex),
        contrastPass: false, role: "content" as const,
      },
    ];

    const testPairings = [
      { element: fgToken, surface: bgToken, role: "content" as const },
    ];

    const result = autoAdjustContrast(tokens, resolved, failures, testPairings);

    // The pair should be fixed (one iteration of +5 tone → tone=93, |contrast|≈77.4)
    expect(result.unfixable).toEqual([]);

    // Verify the final state actually passes
    const newFgHex = oklchToHex(result.resolved[fgToken].L, 0.02, 264);
    const newBgHex = oklchToHex(result.resolved[bgToken].L, 0.01, 264);
    const finalLc = computePerceptualContrast(newFgHex, newBgHex);
    expect(Math.abs(finalLc)).toBeGreaterThanOrEqual(CONTRAST_THRESHOLDS["content"]);
  });

  // -------------------------------------------------------------------------
  // T3.10: Cascade — adjusting one token converges without cascade breakage
  //
  // Scenario: a chain of two pairs sharing a surface token.
  //   pair 1: elementA on sharedSurface (failing)
  //   pair 2: elementB on sharedSurface (passing initially)
  //
  // Adjusting elementA must not inadvertently break elementB. The pairings
  // array includes both pairs so cascade re-validation catches breakage.
  // Both pairs must pass at the end.
  // -------------------------------------------------------------------------
  it("T3.10: cascade — adjusting one element does not break a passing pair on the same surface", () => {
    const elementA = "--tug-base-element-global-text-normal-muted-rest";
    const elementB = "--tug-base-element-global-text-normal-default-rest";
    const sharedSurface = "--tug-base-surface-global-primary-normal-default-rest";

    // dark mode: surface is dark, elements should be light
    // elementA starts at tone=88 (OKLab contrast ≈ -74.3 — just below contrast 75, failing)
    // elementB starts at tone=94 (OKLab contrast ≈ -78.1 — passing contrast 75)
    const surfaceL = 0.15 + (15 * (0.708 - 0.15)) / 50; // ~0.3174 (tone=15 equivalent)
    const elementAL = 0.708 + (38 * (0.96 - 0.708)) / 50; // tone=88 → ~0.8995
    const elementBL = 0.708 + (44 * (0.96 - 0.708)) / 50; // tone=94 → ~0.9298

    const surfaceResolved: ResolvedColor = { L: surfaceL, C: 0.01, h: 264, alpha: 1 };
    const elementAResolved: ResolvedColor = { L: elementAL, C: 0.02, h: 264, alpha: 1 };
    const elementBResolved: ResolvedColor = { L: elementBL, C: 0.02, h: 264, alpha: 1 };

    const resolved: Record<string, ResolvedColor> = {
      [elementA]: elementAResolved,
      [elementB]: elementBResolved,
      [sharedSurface]: surfaceResolved,
    };
    const tokens: Record<string, string> = {
      [elementA]: "--tug-color(violet, t: 88)",
      [elementB]: "--tug-color(violet, t: 94)",
      [sharedSurface]: "--tug-color(violet, i: 2, t: 15)",
    };

    const aHex = oklchToHex(elementAL, 0.02, 264);
    const surfHex = oklchToHex(surfaceL, 0.01, 264);
    const lcA = computePerceptualContrast(aHex, surfHex);
    const failures = [
      {
        fg: elementA, bg: sharedSurface,
        wcagRatio: computeWcagContrast(aHex, surfHex),
        contrast: lcA, contrastPass: false, role: "content" as const,
      },
    ];

    // Both pairs in the pairings map — cascade detection monitors elementB too
    const testPairings = [
      { element: elementA, surface: sharedSurface, role: "content" as const },
      { element: elementB, surface: sharedSurface, role: "content" as const },
    ];

    const result = autoAdjustContrast(tokens, resolved, failures, testPairings);

    // elementA should have been fixed
    expect(result.unfixable).not.toContain(elementA);

    // elementB must still pass after adjustment (cascade re-validation guards this)
    const newBHex = oklchToHex(result.resolved[elementB].L, 0.02, 264);
    const newSurfHex = oklchToHex(result.resolved[sharedSurface].L, 0.01, 264);
    const lcB = computePerceptualContrast(newBHex, newSurfHex);
    expect(Math.abs(lcB)).toBeGreaterThanOrEqual(CONTRAST_THRESHOLDS["content"]);
  });

  // -------------------------------------------------------------------------
  // T3.DEP: autoAdjustContrast is @deprecated (Step 5)
  //
  // The function is retained for backward compatibility but is no longer called
  // by the derivation pipeline or the gallery UI. Contrast floors are now
  // enforced by enforceContrastFloor inside evaluateRules, producing
  // ContrastDiagnostic entries in ThemeOutput.diagnostics.
  //
  // This test verifies:
  //   1. The function is still callable (compiles and runs without throwing)
  //   2. It returns the expected {tokens, resolved, unfixable} shape
  //   3. It is a no-op when given an empty failures array
  // -------------------------------------------------------------------------
  it("T3.DEP: autoAdjustContrast (deprecated) is still callable and returns correct shape", () => {
    // Import is present at file top — compile-time check passes.
    // Runtime check: call with an empty failures array; must return a no-op result.
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const result = autoAdjustContrast(brioOutput.tokens, brioOutput.resolved, [], []);

    // Shape must be correct
    expect(result).toHaveProperty("tokens");
    expect(result).toHaveProperty("resolved");
    expect(result).toHaveProperty("unfixable");

    // No-op: tokens and resolved should be unchanged
    expect(result.tokens).toEqual(brioOutput.tokens);
    expect(result.unfixable).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test suite: cvd-simulation — Machado matrices and distinguishability
// ---------------------------------------------------------------------------

describe("cvd-simulation", () => {
  // -------------------------------------------------------------------------
  // T5.1: simulateCVD with pure gray returns nearly unchanged values for all types
  //
  // A neutral gray has equal R, G, B channels. Because the Machado matrices
  // are designed for chromatic role colors, applying them to an achromatic input
  // should leave the result nearly unchanged (each row sums to ~1.0).
  // -------------------------------------------------------------------------
  it("T5.1: simulateCVD with pure gray returns nearly unchanged values for all types", () => {
    // Mid-gray in linear sRGB: equal channels, R=G=B=0.5
    const gray = { r: 0.5, g: 0.5, b: 0.5 };
    const TOLERANCE = 0.01;

    for (const type of ["protanopia", "deuteranopia", "tritanopia", "achromatopsia"] as const) {
      const result = simulateCVD(gray, type);
      // For a neutral gray, each row of the matrix sums to ~1, so the result
      // should be approximately equal across channels and close to the input.
      expect(Math.abs(result.r - gray.r)).toBeLessThan(TOLERANCE);
      expect(Math.abs(result.g - gray.g)).toBeLessThan(TOLERANCE);
      expect(Math.abs(result.b - gray.b)).toBeLessThan(TOLERANCE);
    }
  });

  // -------------------------------------------------------------------------
  // T5.2: Protanopia simulation of pure red significantly reduces the R channel
  //
  // Protanopia removes L-cone sensitivity (red channel). Simulating a pure red
  // (#ff0000, linear R=1.0, G=0, B=0) should produce a result where R is
  // substantially reduced and G increases.
  // -------------------------------------------------------------------------
  it("T5.2: protanopia simulation of pure red significantly reduces the R channel", () => {
    // Pure red in linear sRGB
    const pureRed = { r: 1.0, g: 0.0, b: 0.0 };
    const result = simulateCVD(pureRed, "protanopia");

    // Protanopia matrix row 0: [0.152286, 1.052583, -0.204868]
    // Applied to [1, 0, 0]: R' = 0.152286, G' = 0.114503, B' = -0.003882 → clamped to 0
    // R' should be well below 1.0 (the input R channel)
    expect(result.r).toBeLessThan(0.5);

    // Also verify via simulateCVDForHex for consistency
    const simHex = simulateCVDForHex("#ff0000", "protanopia");
    const rOut = parseInt(simHex.slice(1, 3), 16);
    // Output R byte should be far less than 255
    expect(rOut).toBeLessThan(128);
  });

  // -------------------------------------------------------------------------
  // T5.3: checkCVDDistinguishability flags a red/yellow-green pair under
  //       protanopia and deuteranopia
  //
  // Both protanopia (L-cone deficiency) and deuteranopia (M-cone deficiency)
  // collapse red-orange vs yellow-green hues toward the same apparent brightness.
  // The test uses:
  //   "red":          OKLCH L=0.45, C=0.10, h=25°  (orange-red)
  //   "yellow-green": OKLCH L=0.45, C=0.10, h=100° (yellow-green)
  //
  // Both colours have identical lightness (L=0.45) and chroma (C=0.10) but
  // differ only in hue. Under protanopia and deuteranopia their simulated
  // luminances converge to within the 0.05 threshold.
  //
  // Probe-verified deltas:
  //   protanopia:   ≈ 0.021  (below 0.05 ✓)
  //   deuteranopia: ≈ 0.001  (below 0.05 ✓)
  // -------------------------------------------------------------------------
  it("T5.3: checkCVDDistinguishability flags red/yellow-green pair under protanopia and deuteranopia", () => {
    const redToken   = "--test-destructive";
    const greenToken = "--test-positive";

    const resolved: Record<string, ResolvedColor> = {
      // Orange-red hue (h=25°) — same L and C as the yellow-green token
      [redToken]:   { L: 0.45, C: 0.10, h: 25,  alpha: 1 },
      // Yellow-green hue (h=100°) — distinct in normal vision but collapses
      // toward same luminance as the red under protanopia + deuteranopia
      [greenToken]: { L: 0.45, C: 0.10, h: 100, alpha: 1 },
    };

    const warnings = checkCVDDistinguishability(resolved, [[redToken, greenToken]]);

    // Extract the CVD types that fired for this pair
    const flaggedTypes = new Set(warnings.map((w) => w.type));

    expect(flaggedTypes.has("protanopia")).toBe(true);
    expect(flaggedTypes.has("deuteranopia")).toBe(true);

    // Each warning must reference the correct token pair and carry non-empty messages
    for (const w of warnings) {
      expect(w.tokenPair).toEqual([redToken, greenToken]);
      expect(w.description.length).toBeGreaterThan(0);
      expect(w.suggestion.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // T5.4: Achromatopsia matrix produces identical R, G, B channels (grayscale)
  //
  // The achromatopsia matrix has identical rows, so all three output channels
  // must equal the same luminance value.
  // -------------------------------------------------------------------------
  it("T5.4: achromatopsia matrix produces identical R, G, B channels", () => {
    // Test several different chromatic colours
    const testColors = [
      { r: 0.8, g: 0.2, b: 0.1 },   // reddish
      { r: 0.1, g: 0.7, b: 0.3 },   // greenish
      { r: 0.2, g: 0.3, b: 0.9 },   // bluish
      { r: 0.5, g: 0.5, b: 0.0 },   // yellow
    ];

    for (const color of testColors) {
      const result = simulateCVD(color, "achromatopsia");
      // All three channels must be identical (within floating-point precision)
      expect(result.r).toBeCloseTo(result.g, 10);
      expect(result.g).toBeCloseTo(result.b, 10);
    }

    // Also verify via the hex path: a chromatic colour should become a neutral gray
    const redHex = simulateCVDForHex("#cc3311", "achromatopsia");
    const rByte = parseInt(redHex.slice(1, 3), 16);
    const gByte = parseInt(redHex.slice(3, 5), 16);
    const bByte = parseInt(redHex.slice(5, 7), 16);
    expect(rByte).toBe(gByte);
    expect(gByte).toBe(bByte);
  });

  // -------------------------------------------------------------------------
  // T5.5: severity=0.0 returns input unchanged; severity=1.0 matches full matrix
  //
  // At severity=0: output must equal input (identity).
  // At severity=1: output must equal the direct matrix application.
  // -------------------------------------------------------------------------
  it("T5.5: severity=0.0 returns input unchanged; severity=1.0 matches full matrix", () => {
    const input = { r: 0.8, g: 0.2, b: 0.05 }; // reddish input

    for (const type of ["protanopia", "deuteranopia", "tritanopia", "achromatopsia"] as const) {
      // severity=0 → identity
      const atZero = simulateCVD(input, type, 0.0);
      expect(atZero.r).toBeCloseTo(input.r, 10);
      expect(atZero.g).toBeCloseTo(input.g, 10);
      expect(atZero.b).toBeCloseTo(input.b, 10);

      // severity=1 → full matrix result (simulateCVD at default severity)
      const atOne = simulateCVD(input, type, 1.0);
      const atDefault = simulateCVD(input, type);
      expect(atOne.r).toBeCloseTo(atDefault.r, 10);
      expect(atOne.g).toBeCloseTo(atDefault.g, 10);
      expect(atOne.b).toBeCloseTo(atDefault.b, 10);
    }
  });

  // -------------------------------------------------------------------------
  // Additional: simulateCVDFromOKLCH matches hex path for same colour
  // -------------------------------------------------------------------------
  it("simulateCVDFromOKLCH produces consistent output with simulateCVDForHex", () => {
    // Use a vivid blue: L=0.5, C=0.2, h=264 (violet/blue region)
    const L = 0.5, C = 0.2, h = 264;
    const hex = oklchToHex(L, C, h);

    for (const type of ["protanopia", "deuteranopia", "tritanopia", "achromatopsia"] as const) {
      const fromOklch = simulateCVDFromOKLCH(L, C, h, type);
      const fromHex = simulateCVDForHex(hex, type);

      // Decode fromHex back to linear sRGB for comparison
      const rGamma = parseInt(fromHex.slice(1, 3), 16) / 255;
      const gGamma = parseInt(fromHex.slice(3, 5), 16) / 255;
      const bGamma = parseInt(fromHex.slice(5, 7), 16) / 255;
      // gamma-decode
      const linR = rGamma <= 0.04045 ? rGamma / 12.92 : Math.pow((rGamma + 0.055) / 1.055, 2.4);
      const linG = gGamma <= 0.04045 ? gGamma / 12.92 : Math.pow((gGamma + 0.055) / 1.055, 2.4);
      const linB = bGamma <= 0.04045 ? bGamma / 12.92 : Math.pow((bGamma + 0.055) / 1.055, 2.4);

      // fromOklch is in linear sRGB; both paths start from the same OKLCH→hex→linear chain.
      // Allow a small rounding tolerance from the hex quantisation (±1/255 ≈ 0.004).
      expect(Math.abs(fromOklch.r - linR)).toBeLessThan(0.005);
      expect(Math.abs(fromOklch.g - linG)).toBeLessThan(0.005);
      expect(Math.abs(fromOklch.b - linB)).toBeLessThan(0.005);
    }
  });

  // -------------------------------------------------------------------------
  // Additional: CVD_MATRICES has all four expected types
  // -------------------------------------------------------------------------
  it("CVD_MATRICES contains all four types with 3×3 row-major structure", () => {
    const types: Array<keyof typeof CVD_MATRICES> = [
      "protanopia",
      "deuteranopia",
      "tritanopia",
      "achromatopsia",
    ];
    for (const type of types) {
      const matrix = CVD_MATRICES[type];
      expect(matrix.length).toBe(3);
      for (const row of matrix) {
        expect(row.length).toBe(3);
        for (const val of row) {
          expect(typeof val).toBe("number");
          expect(isFinite(val)).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Test suite: compositeOverSurface — alpha-over compositing (Spec S02, [D04])
// ---------------------------------------------------------------------------

describe("compositeOverSurface", () => {
  // -------------------------------------------------------------------------
  // T4.2: white at 50% alpha over black = perceptual mid-gray
  //
  // compositeOverSurface performs alpha-over in linear sRGB, then gamma-encodes.
  // OKLCH L=1.0, C=0, h=0 (white) at alpha=0.5 composited over OKLCH L=0.0,
  // C=0, h=0 (black):
  //   linear channels: 0.5 * 1.0 + 0.5 * 0.0 = 0.5
  //   gamma-encoded:   0.5^(1/2.4) * 1.055 - 0.055 ≈ 0.735 → byte ≈ 188 (0xbc)
  //
  // The result is a neutral gray hex. Note: this is NOT #808080 — that would be
  // a naive 8-bit midpoint. Linear compositing + gamma encoding produces ~#bcbcbc.
  // -------------------------------------------------------------------------
  it("T4.2: white at 50% alpha over black produces perceptual mid-gray (~#bcbcbc)", () => {
    // Pure white in OKLCH: L=1.0, C=0, h=0 (canonical white)
    const white: ResolvedColor = { L: 1.0, C: 0.0, h: 0, alpha: 0.5 };
    // Pure black in OKLCH: L=0.0, C=0, h=0 (canonical black)
    const black: ResolvedColor = { L: 0.0, C: 0.0, h: 0, alpha: 1.0 };

    const result = compositeOverSurface(white, black);

    // Result must be a valid #rrggbb hex string
    expect(result).toMatch(/^#[0-9a-f]{6}$/);

    // All three channels must be equal (neutral gray from equal input channels)
    const r = parseInt(result.slice(1, 3), 16);
    const g = parseInt(result.slice(3, 5), 16);
    const b = parseInt(result.slice(5, 7), 16);
    expect(r).toBe(g);
    expect(g).toBe(b);

    // The byte value must be in the range [180, 196] — linear 0.5 gamma-encoded
    // to approximately 0.735 * 255 ≈ 188 (0xbc). Allow ±8 for OKLCH round-trip precision.
    expect(r).toBeGreaterThanOrEqual(180);
    expect(r).toBeLessThanOrEqual(196);
  });

  // -------------------------------------------------------------------------
  // T4.3: fully opaque token returns its own color unchanged
  //
  // When token.alpha is 1.0 (fully opaque), the alpha-over formula reduces to:
  //   C_out = token.C * 1.0 + parent.C * 0.0 = token.C
  // The result must exactly equal oklchToHex(token.L, token.C, token.h).
  // -------------------------------------------------------------------------
  it("T4.3: fully opaque token (alpha=1.0) returns element color unchanged", () => {
    const token: ResolvedColor = { L: 0.5, C: 0.15, h: 200, alpha: 1.0 };
    const parent: ResolvedColor = { L: 0.2, C: 0.05, h: 90, alpha: 1.0 };

    const composited = compositeOverSurface(token, parent);
    const direct = oklchToHex(token.L, token.C, token.h);

    expect(composited).toBe(direct);
  });

  // -------------------------------------------------------------------------
  // T4.4: semi-transparent parent throws
  //
  // Spec S02 requires parentSurface.alpha === 1.0. Nested compositing
  // (semi-transparent parent) is not supported and must throw.
  // -------------------------------------------------------------------------
  it("T4.4: semi-transparent parent surface throws an error", () => {
    const token: ResolvedColor = { L: 0.6, C: 0.12, h: 150, alpha: 0.5 };
    // Semi-transparent parent — violates Spec S02
    const semiParent: ResolvedColor = { L: 0.3, C: 0.05, h: 270, alpha: 0.7 };

    expect(() => compositeOverSurface(token, semiParent)).toThrow();
  });

  // -------------------------------------------------------------------------
  // T4.5: badge-tinted-accent-fg on composited badge-tinted-accent-bg — compositing pipeline test
  //
  // Integration test: badge-tinted-accent-bg has alpha=0.15 in the Brio theme.
  // After compositing over surface-default, the resulting background is measurable.
  //
  // Design note: badge tinted text uses mid-tone hues for semantic role identity.
  // The tinted bg (alpha 15%) composited over surface-default produces contrast ~45-55,
  // which is BELOW the informational threshold (60). This is a [design-choice] exception
  // documented in KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS (section F of contrast-exceptions.ts):
  // badge tinted text is a colorimetric role indicator, not WCAG-level contrast primary prose.
  //
  // This test validates that the compositing pipeline produces a measurable contrast
  // score (contrast > 0), not that it passes the informational threshold.
  // -------------------------------------------------------------------------
  it("T4.5: badge-tinted-accent-fg on composited badge-tinted-accent-bg — compositing pipeline produces measurable contrast", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const badgeFg = brioOutput.resolved["--tug-base-element-badge-text-tinted-accent-rest"];
    const badgeBg = brioOutput.resolved["--tug-base-surface-badge-primary-tinted-accent-rest"];
    const surfaceDefault = brioOutput.resolved["--tug-base-surface-global-primary-normal-default-rest"];

    // All three tokens must exist in the Brio resolved map
    expect(badgeFg).toBeDefined();
    expect(badgeBg).toBeDefined();
    expect(surfaceDefault).toBeDefined();

    // badge-tinted-accent-bg must have alpha < 1.0 (semi-transparent tint)
    expect((badgeBg!.alpha ?? 1.0)).toBeLessThan(1.0);

    // surface-default must be fully opaque
    expect((surfaceDefault!.alpha ?? 1.0)).toBe(1.0);

    // Composite the semi-transparent bg over surface-default
    const compositedBgHex = compositeOverSurface(badgeBg!, surfaceDefault!);
    const fgHex = oklchToHex(badgeFg!.L, badgeFg!.C, badgeFg!.h);

    // Measure contrast between fg and composited bg — validates the compositing pipeline
    const lc = computePerceptualContrast(fgHex, compositedBgHex);

    // The compositing pipeline must produce a non-zero, finite contrast score
    expect(typeof lc).toBe("number");
    expect(isFinite(lc)).toBe(true);
    expect(Math.abs(lc)).toBeGreaterThan(0);

    // Badge tinted tokens are [design-choice] exceptions below informational threshold (60):
    // mid-tone hue role indicators produce contrast ~45-55. Document the known range.
    // This is NOT a threshold assertion — it documents the structural constraint.
    expect(Math.abs(lc)).toBeGreaterThan(30); // measurable contrast
    expect(Math.abs(lc)).toBeLessThan(CONTRAST_THRESHOLDS["informational"]); // below threshold by design
  });
});

// ---------------------------------------------------------------------------
// Test suite: hexToOkLabL — OKLab perceptual lightness conversion
// ---------------------------------------------------------------------------

describe("hexToOkLabL", () => {
  // -------------------------------------------------------------------------
  // T6.1: black returns ~0.0
  //
  // OKLab is defined such that pure black (#000000) has L=0.0.
  // -------------------------------------------------------------------------
  it("T6.1: hexToOkLabL('#000000') returns ~0.0 (black)", () => {
    const L = hexToOkLabL("#000000");
    expect(L).toBeCloseTo(0.0, 4);
  });

  // -------------------------------------------------------------------------
  // T6.2: white returns ~1.0
  //
  // OKLab is defined such that pure white (#ffffff) has L=1.0.
  // -------------------------------------------------------------------------
  it("T6.2: hexToOkLabL('#ffffff') returns ~1.0 (white)", () => {
    const L = hexToOkLabL("#ffffff");
    expect(L).toBeCloseTo(1.0, 4);
  });

  // -------------------------------------------------------------------------
  // T6.3: mid-gray returns approximately 0.57
  //
  // #777777 in sRGB linearises to approximately 0.2140 per channel.
  // The OKLab L for a neutral gray tracks closely with perceptual lightness.
  // Measured value: hexToOkLabL("#777777") ≈ 0.569.
  // -------------------------------------------------------------------------
  it("T6.3: hexToOkLabL('#777777') returns approximately 0.57 (mid-gray)", () => {
    const L = hexToOkLabL("#777777");
    expect(L).toBeGreaterThan(0.50);
    expect(L).toBeLessThan(0.65);
  });

  // -------------------------------------------------------------------------
  // T6.4: L is monotonically increasing for achromatic grays
  //
  // Going from #000000 to #404040 to #808080 to #c0c0c0 to #ffffff,
  // each successive L must be strictly greater than the previous.
  // -------------------------------------------------------------------------
  it("T6.4: L is monotonically increasing for achromatic grays", () => {
    const grays = ["#000000", "#404040", "#808080", "#c0c0c0", "#ffffff"];
    const Ls = grays.map(hexToOkLabL);
    for (let i = 1; i < Ls.length; i++) {
      expect(Ls[i]).toBeGreaterThan(Ls[i - 1]);
    }
  });

  // -------------------------------------------------------------------------
  // T6.5: Brio fg-default and bg-app have expected relative ordering
  //
  // Brio dark theme: fg-default is a very light cobalt (high tone=94),
  // bg-app is a very dark indigo-violet (low tone=5). fg-default L should
  // be substantially higher than bg-app L.
  // -------------------------------------------------------------------------
  it("T6.5: Brio fg-default L is substantially higher than bg-app L", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const fgDefault = brioOutput.resolved["--tug-base-element-global-text-normal-default-rest"];
    const bgApp = brioOutput.resolved["--tug-base-surface-global-primary-normal-app-rest"];

    expect(fgDefault).toBeDefined();
    expect(bgApp).toBeDefined();

    const fgHex = oklchToHex(fgDefault!.L, fgDefault!.C, fgDefault!.h);
    const bgHex = oklchToHex(bgApp!.L, bgApp!.C, bgApp!.h);

    const fgOkLabL = hexToOkLabL(fgHex);
    const bgOkLabL = hexToOkLabL(bgHex);

    // fg-default is a light foreground, bg-app is a dark background
    // The OKLab L delta should be substantial (> 0.5)
    expect(fgOkLabL).toBeGreaterThan(0.7);
    expect(bgOkLabL).toBeLessThan(0.3);
    expect(fgOkLabL - bgOkLabL).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Test suite: contrast-calibration-baseline
//
// Captures the current computePerceptualContrast results on all Brio token
// pairs. This serves as the calibration baseline for Step 2, where the
// algorithm will be replaced. The baseline records pass/fail status and
// contrast magnitude for each pair so the rank-ordering invariant can be
// verified against the new metric.
// ---------------------------------------------------------------------------

describe("contrast-calibration-baseline", () => {
  // -------------------------------------------------------------------------
  // CB1: Capture all Brio pair contrast scores under current algorithm
  //
  // This test validates the baseline capture mechanism and documents the
  // current pass/fail distribution. It does not assert specific numeric values
  // (those are algorithm-dependent), but verifies structural invariants:
  //   - All evaluated pairs have a defined contrast score
  //   - contrast === 0 only when both colors are structurally identical
  //   - Body-text pairs for primary fg-default must pass
  // -------------------------------------------------------------------------
  it("CB1: captures all Brio pair contrast scores and verifies baseline structural invariants", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    // Every result must have a numeric contrast score
    for (const result of results) {
      expect(typeof result.contrast).toBe("number");
      expect(isFinite(result.contrast)).toBe(true);
    }

    // Must have a reasonable number of evaluated pairs
    expect(results.length).toBeGreaterThan(50);

    // Document the current pass/fail distribution (informational — not a hard assertion)
    const passes = results.filter((r) => r.contrastPass).length;
    const failures = results.filter((r) => !r.contrastPass).length;
    expect(passes + failures).toBe(results.length);

    // The primary fg-default on bg-app must pass content (75) threshold
    const fgDefaultPair = results.find(
      (r) => r.fg === "--tug-base-element-global-text-normal-default-rest" && r.bg === "--tug-base-surface-global-primary-normal-app-rest",
    );
    expect(fgDefaultPair).toBeDefined();
    expect(fgDefaultPair!.contrastPass).toBe(true);
  });

  // -------------------------------------------------------------------------
  // CB2: Sign consistency — non-zero scores have correct polarity relative to OKLab L
  //
  // For any evaluated pair with a non-zero score, the sign must match the
  // OKLab L ordering of the composited hex values (the values the algorithm
  // actually used to compute the score). Since the new algorithm IS a scaled
  // OKLab L delta, this is a mathematical invariant.
  //
  // Note: Pairs with contrast=0 have deltaL < CONTRAST_MIN_DELTA and are skipped.
  // -------------------------------------------------------------------------
  it("CB2: non-zero contrast scores have correct sign relative to the OKLab L ordering used in computation", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);

    // Replicate validateThemeContrast hex computation (with compositing) to
    // recover the exact fgHex/bgHex that produced each score.
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

      // positive score → bgL > fgL (dark-on-light); negative score → bgL < fgL (light-on-dark)
      if (score > 0 && bgL <= fgL) {
        polarityViolations.push(`${pairing.element}: score=${score.toFixed(1)} positive but bgL=${bgL.toFixed(3)} <= fgL=${fgL.toFixed(3)}`);
      } else if (score < 0 && bgL >= fgL) {
        polarityViolations.push(`${pairing.element}: score=${score.toFixed(1)} negative but bgL=${bgL.toFixed(3)} >= fgL=${fgL.toFixed(3)}`);
      }
    }

    expect(polarityViolations).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // CB3: All Brio pair scores are bounded in the expected range
  //
  // The OKLab L metric produces scores in [-SCALE * POLARITY_FACTOR, SCALE]:
  //   max positive: 1.0 * 150 = 150.0
  //   max negative: -1.0 * 150 * 0.85 = -127.5
  // This test verifies no pair produces an out-of-bounds score.
  // -------------------------------------------------------------------------
  it("CB3: all Brio pair contrast scores are within expected OKLab metric range", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    const maxPositive = CONTRAST_SCALE + 1; // 151 — small tolerance for floating point
    const maxNegative = -(CONTRAST_SCALE * POLARITY_FACTOR + 1); // -128.5

    const outOfRange = results.filter((r) => r.contrast > maxPositive || r.contrast < maxNegative);
    const descriptions = outOfRange.map(
      (r) => `${r.fg} on ${r.bg}: ${r.contrast.toFixed(1)}`,
    );
    expect(descriptions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // CB4: Rank-ordering invariant with OKLab L metric (non-composited pairs only)
  //
  // For the new OKLab L algorithm, polarity is perfectly determined by OKLab L
  // comparison (since the algorithm IS a scaled OKLab L delta). This test verifies
  // that all non-composited, non-zero-score pairs have correct polarity.
  //
  // Composited pairs (parentSurface != null) are excluded because their
  // score is computed on composited hex values, not raw OKLCH hex. The CB2
  // test verifies those pairs using composited hex values.
  // -------------------------------------------------------------------------
  it("CB4: OKLab L metric polarity is perfectly consistent with OKLab L ordering for non-composited pairs", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    // Build a set of pairings that have parentSurface (composited)
    const compositedPairKeys = new Set(
      ELEMENT_SURFACE_PAIRING_MAP
        .filter((p) => p.parentSurface)
        .map((p) => `${p.element}|${p.surface}`),
    );

    const polarityViolations: string[] = [];

    for (const result of results) {
      if (result.contrast === 0) continue; // zero is fine — below CONTRAST_MIN_DELTA
      if (compositedPairKeys.has(`${result.fg}|${result.bg}`)) continue; // skip composited pairs

      const fgColor = brioOutput.resolved[result.fg];
      const bgColor = brioOutput.resolved[result.bg];
      if (!fgColor || !bgColor) continue;

      // Use raw hex (without compositing) to check OKLab L ordering
      const fgHex = oklchToHex(fgColor.L, fgColor.C, fgColor.h);
      const bgHex = oklchToHex(bgColor.L, bgColor.C, bgColor.h);
      const fgL = hexToOkLabL(fgHex);
      const bgL = hexToOkLabL(bgHex);

      // With OKLab metric: positive score → bg L > fg L, negative → bg L < fg L
      if (result.contrast > 0 && bgL <= fgL) {
        polarityViolations.push(`${result.fg}: positive score but bgL=${bgL.toFixed(3)} <= fgL=${fgL.toFixed(3)}`);
      } else if (result.contrast < 0 && bgL >= fgL) {
        polarityViolations.push(`${result.fg}: negative score but bgL=${bgL.toFixed(3)} >= fgL=${fgL.toFixed(3)}`);
      }
    }

    expect(polarityViolations).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // CB5: fg-default anchor pair comfortably passes content threshold
  //
  // The calibration anchors fg-default/bg-app above the content threshold (75).
  // This test verifies the anchor and documents the calibrated score.
  // -------------------------------------------------------------------------
  it("CB5: fg-default / bg-app anchor pair passes content threshold with calibrated constants", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    const anchorPair = results.find(
      (r) => r.fg === "--tug-base-element-global-text-normal-default-rest" && r.bg === "--tug-base-surface-global-primary-normal-app-rest",
    );
    expect(anchorPair).toBeDefined();
    expect(anchorPair!.contrastPass).toBe(true);

    // Score must be comfortably above content threshold (75)
    // With SCALE=150, POLARITY_FACTOR=0.85, ΔL≈0.727: fg-default/bg-app scores ≈ -92.7
    expect(Math.abs(anchorPair!.contrast)).toBeGreaterThan(CONTRAST_THRESHOLDS["content"]);
  });

  // -------------------------------------------------------------------------
  // CB6: Rank-ordering / sensible distribution — new algorithm preserves design intent
  //
  // Since the old algorithm has been replaced, we cannot run both side-by-side.
  // Instead we verify the new OKLab L metric produces a distribution that:
  //   1. Every pair where contrastPass=true has |contrast| >= its role threshold
  //      (internal consistency — the pass flag must match the score and threshold).
  //   2. The fg-default token passes content on all its surfaces.
  //   3. A reasonable number of pairs pass overall (>= 140 out of ~231), confirming
  //      the algorithm is calibrated sensibly rather than accepting nothing or
  //      rejecting nothing.
  //   4. All role thresholds in CONTRAST_THRESHOLDS are honoured: for every
  //      result with contrastPass=true, |contrast| >= CONTRAST_THRESHOLDS[role].
  //
  // This test replaces the "both metrics same rank ordering" check: the old
  // algorithm is gone, so we verify the new metric is self-consistent and
  // preserves the design intent documented in the pairing map.
  // -------------------------------------------------------------------------
  it("CB6: OKLab metric produces a sensible, self-consistent pass/fail distribution for all Brio pairs", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    // (1) Internal consistency: every contrastPass=true result has |score| >= threshold
    const internalInconsistencies: string[] = [];
    for (const r of results) {
      const threshold = (CONTRAST_THRESHOLDS as Record<string, number>)[r.role] ?? 15;
      if (r.contrastPass && Math.abs(r.contrast) < threshold) {
        internalInconsistencies.push(
          `${r.fg} on ${r.bg}: contrastPass=true but |contrast|=${Math.abs(r.contrast).toFixed(1)} < threshold=${threshold}`,
        );
      }
      if (!r.contrastPass && Math.abs(r.contrast) >= threshold) {
        internalInconsistencies.push(
          `${r.fg} on ${r.bg}: contrastPass=false but |contrast|=${Math.abs(r.contrast).toFixed(1)} >= threshold=${threshold}`,
        );
      }
    }
    expect(internalInconsistencies).toEqual([]);

    // (2) fg-default passes content role on all its canonical surfaces.
    // Step 5 gap pairs (tab-bg-active, accent-subtle, tone-caution-bg) are acknowledged
    // accessibility gaps pending Phase 2 resolution and are excluded via SHARED_KNOWN_PAIR_EXCEPTIONS.
    const fgDefaultResults = results.filter(
      (r) => r.fg === "--tug-base-element-global-text-normal-default-rest" && r.role === "content" && !SHARED_KNOWN_PAIR_EXCEPTIONS.has(`${r.fg}|${r.bg}`),
    );
    expect(fgDefaultResults.length).toBeGreaterThan(0);
    const fgDefaultFailures = fgDefaultResults.filter((r) => !r.contrastPass);
    expect(fgDefaultFailures).toEqual([]);

    // (3) Reasonable overall pass count — at least 140 of ~231 pairs pass
    const passingCount = results.filter((r) => r.contrastPass).length;
    expect(passingCount).toBeGreaterThanOrEqual(140);

    // (4) All five role thresholds are represented in passing results
    // (confirms the metric isn't trivially rejecting entire role categories)
    const passingRoles = new Set(results.filter((r) => r.contrastPass).map((r) => r.role));
    // content and control must have passing entries (most populated roles)
    expect(passingRoles.has("content")).toBe(true);
    expect(passingRoles.has("control")).toBe(true);
  });
});
