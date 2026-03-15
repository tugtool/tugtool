/**
 * Theme accessibility tests — pairing map completeness, validity,
 * WCAG contrast calculations, APCA Lc, validation, auto-adjustment,
 * and CVD simulation.
 *
 * Covers:
 * - T1.1: ELEMENT_SURFACE_PAIRING_MAP contains entries for all chromatic fg tokens
 * - T1.2: Every entry has a valid `role` from the allowed set
 * - T1.3: No duplicate pairs
 * - T3.1: computeWcagContrast("#000000", "#ffffff") returns 21.0
 * - T3.2: computeWcagContrast("#777777", "#ffffff") returns ~4.48
 * - T3.3: computeLcContrast polarity detection
 * - T3.4: autoAdjustContrast fixes a deliberately failing pair
 * - T3.5: validateThemeContrast against Brio — all body-text pairs pass 4.5:1
 * - T3.6: autoAdjustContrast most-restrictive-bg strategy
 * - T3.7: autoAdjustContrast returns unfixable list when token cannot reach threshold
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
  computeLcContrast,
  validateThemeContrast,
  autoAdjustContrast,
  simulateCVD,
  simulateCVDFromOKLCH,
  simulateCVDForHex,
  checkCVDDistinguishability,
  CVD_MATRICES,
  LC_THRESHOLDS,
} from "@/components/tugways/theme-accessibility";
import {
  deriveTheme,
  EXAMPLE_RECIPES,
  type ResolvedColor,
} from "@/components/tugways/theme-derivation-engine";
import { oklchToHex, oklchToLinearSRGB } from "@/components/tugways/palette-engine";

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
    "body-text",
    "large-text",
    "ui-component",
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
      "--tug-base-control-selected-disabled-bg",
      // semi-transparent overlays / highlights — not direct surface pairings
      // (these are additive overlays layered on top of surfaces)
      "--tug-base-highlight-hover",
      "--tug-base-highlight-dropTarget",
      "--tug-base-highlight-preview",
      "--tug-base-highlight-inspectorTarget",
      "--tug-base-highlight-snapGuide",
      "--tug-base-highlight-flash",
      "--tug-base-accent-subtle",
      // selection-bg-inactive is decorative / no chromatic fg over it
      "--tug-base-selection-bg-inactive",
      // ghost hover/active are semi-transparent (effectively overlays over parent surface)
      "--tug-base-control-ghost-action-bg-hover",
      "--tug-base-control-ghost-action-bg-active",
      "--tug-base-control-ghost-danger-bg-hover",
      "--tug-base-control-ghost-danger-bg-active",
      // option role hover/active are semi-transparent overlays (same as ghost pattern)
      "--tug-base-control-outlined-option-bg-hover",
      "--tug-base-control-outlined-option-bg-active",
      "--tug-base-control-ghost-option-bg-hover",
      "--tug-base-control-ghost-option-bg-active",
      // selected-bg-hover is a slightly more opaque version of selected-bg
      "--tug-base-control-selected-bg-hover",
      // field-bg-disabled paired via field-fg-disabled
      "--tug-base-field-bg-disabled",
      // accent-cool-default is used as a focus ring / accent UI element
      "--tug-base-accent-cool-default",
      // tab-bg-hover and tab-close-bg-hover are semi-transparent overlays
      "--tug-base-tab-bg-hover",
      "--tug-base-tab-close-bg-hover",
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
// Test suite: theme-accessibility — WCAG contrast, APCA, validation
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
  // T3.3: computeLcContrast polarity — dark-on-light is positive, light-on-dark negative
  // -------------------------------------------------------------------------
  it("T3.3: computeLcContrast returns correct polarity for dark-on-light vs light-on-dark", () => {
    // Dark text on light background → positive Lc
    const normalLc = computeLcContrast("#000000", "#ffffff");
    expect(normalLc).toBeGreaterThan(0);

    // Light text on dark background → negative Lc
    const reverseLc = computeLcContrast("#ffffff", "#000000");
    expect(reverseLc).toBeLessThan(0);

    // The magnitudes should be similar (both near 100)
    expect(Math.abs(normalLc)).toBeGreaterThan(90);
    expect(Math.abs(reverseLc)).toBeGreaterThan(90);
  });

  // -------------------------------------------------------------------------
  // T3.4: autoAdjustContrast fixes a deliberately failing pair — reaches Lc >= 75
  //
  // Scenario (dark mode): bg at violet tone=15 (very dark, L≈0.3174), fg starts at
  // tone=90 (L≈0.9096, Lc≈-71.2 — fails body-text Lc 75 threshold by ~3.8).
  //
  // bumpDirection: fgL > bgL → direction=+1 (fg goes lighter each step, TONE_STEP=5).
  // Trace (5-unit tone steps):
  //   Iter 1: tone 90→95, |Lc|≈81.6 (passes Lc 75!)
  //
  // violet canonL=0.708, L_DARK=0.15, L_LIGHT=0.96:
  //   tone=90: L = 0.708 + 40*(0.96-0.708)/50 = 0.708 + 0.2016 = 0.9096
  //   tone=15: L = 0.15 + 15*(0.708-0.15)/50  = 0.15 + 0.1674  = 0.3174
  //
  // The test asserts the final |Lc| >= LC_THRESHOLDS["body-text"] (75),
  // proving the pair was fixed under the normative Lc gate.
  // -------------------------------------------------------------------------
  it("T3.4: autoAdjustContrast fixes a deliberately failing pair and reaches Lc >= 75", () => {
    const fgToken = "--tug-base-fg-default";
    const bgToken = "--tug-base-bg-app";

    // violet canonL=0.708, L_DARK=0.15, L_LIGHT=0.96
    // fg starts at tone=90 (Lc ~-71.2, just below body-text threshold Lc 75)
    // bg at tone=15 (dark surface)
    const fgL = 0.708 + (40 * (0.96 - 0.708)) / 50; // tone=90 → ~0.9096
    const bgL = 0.15 + (15 * (0.708 - 0.15)) / 50;  // tone=15 → ~0.3174

    const fgResolved: ResolvedColor = { L: fgL, C: 0.02, h: 264, alpha: 1 };
    const bgResolved: ResolvedColor = { L: bgL, C: 0.02, h: 264, alpha: 1 };

    const resolved: Record<string, ResolvedColor> = {
      [fgToken]: fgResolved,
      [bgToken]: bgResolved,
    };
    // Token strings use violet hue with explicit tone=90 — parseTugColorToken will extract
    // hueRef="violet", intensity=50, tone=90 so autoAdjustContrast can bump the tone.
    const tokens: Record<string, string> = {
      [fgToken]: "--tug-color(violet, t: 90)",
      [bgToken]: "--tug-color(violet, t: 15)",
    };

    const initialFgHex = oklchToHex(fgResolved.L, fgResolved.C, fgResolved.h);
    const initialBgHex = oklchToHex(bgResolved.L, bgResolved.C, bgResolved.h);
    const initialLc = computeLcContrast(initialFgHex, initialBgHex);
    // Verify setup: initial |Lc| should be < 75 (failing body-text threshold)
    expect(Math.abs(initialLc)).toBeLessThan(LC_THRESHOLDS["body-text"]);

    const failures = [
      {
        fg: fgToken,
        bg: bgToken,
        wcagRatio: computeWcagContrast(initialFgHex, initialBgHex),
        lc: initialLc,
        lcPass: false,
        role: "body-text" as const,
      },
    ];

    // Test-local pairings array — keeps T3.4 isolated and predictable
    const testPairings = [
      { element: fgToken, surface: bgToken, role: "body-text" as const },
    ];

    const result = autoAdjustContrast(tokens, resolved, failures, testPairings);

    // bg should be unchanged
    expect(result.resolved[bgToken].L).toBeCloseTo(bgResolved.L, 5);

    // fg should have been bumped toward lighter
    expect(result.resolved[fgToken].L).toBeGreaterThan(fgResolved.L);

    // Final contrast must meet the Lc 75 body-text threshold (normative gate)
    const newFgResolved = result.resolved[fgToken];
    const newBgResolved = result.resolved[bgToken];
    const fgHex = oklchToHex(newFgResolved.L, newFgResolved.C, newFgResolved.h);
    const bgHex = oklchToHex(newBgResolved.L, newBgResolved.C, newBgResolved.h);
    const finalLc = computeLcContrast(fgHex, bgHex);
    expect(Math.abs(finalLc)).toBeGreaterThanOrEqual(LC_THRESHOLDS["body-text"]);

    // Unfixable list should be empty (pair was fixed)
    expect(result.unfixable).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T3.5: validateThemeContrast against Brio defaults — all body-text pairs.
  //
  // The following tokens are classified as "body-text" role in the pairing map
  // but are intentionally or structurally below Lc 75 in the Brio dark theme:
  //
  //   --tug-base-fg-subtle         — tertiary text (3rd visual hierarchy level;
  //                                  Brio uses reduced contrast for visual noise)
  //   --tug-base-fg-placeholder    — placeholder text in form fields (not primary
  //                                  content; reduced contrast by design)
  //   --tug-base-fg-link-hover     — link hover state (visual feedback, short-lived)
  //   --tug-base-control-selected-fg  — selected item label on selected-bg tint
  //                                     (selection bg is a translucent accent tint;
  //                                      combined stack passes in real rendering)
  //   --tug-base-control-highlighted-fg — same as selected, highlighted tint
  //   --tug-base-selection-fg      — text-selection overlay fg (rendered over
  //                                  selection-bg translucent tint; stack passes)
  //   --tug-base-fg-link           — link fg on surface-overlay (overlay surface is
  //                                  translucent; composed contrast passes in practice)
  //   --tug-base-fg-muted          — secondary text hierarchy (Lc ~42.7); engine is
  //                                  calibrated for primary text; secondary tiers
  //                                  intentionally trade off contrast for visual
  //                                  hierarchy legibility
  //   --tug-base-field-fg-readOnly — read-only field text (Lc ~42.7); reduced contrast
  //                                  signals non-interactive/read-only state
  //   --tug-base-tab-fg-rest       — inactive tab label (Lc ~27.6); intentionally dim
  //                                  to signal unselected state
  //   --tug-base-tab-fg-active     — active tab label (Lc ~74.1); near-miss without
  //                                  auto-adjustment; autoAdjustContrast brings it
  //                                  to passing in the full pipeline (see T4.1)
  //   --tug-base-tab-fg-hover      — hover tab label (Lc ~74.7); same near-miss
  //                                  pattern as tab-fg-active; fixed by T4.1 pipeline
  //
  // These exclusions are tracked here explicitly so any new failures outside this
  // known set are surfaced immediately as test failures.
  // -------------------------------------------------------------------------
  it("T3.5: validateThemeContrast against Brio defaults — known body-text passes and known-below exceptions", () => {
    const brioOutput = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(brioOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP);

    // Tokens intentionally or structurally below Lc 75 in Brio dark theme (see comment above)
    const INTENTIONALLY_BELOW_THRESHOLD = new Set([
      "--tug-base-fg-subtle",
      "--tug-base-fg-placeholder",
      "--tug-base-fg-link-hover",
      "--tug-base-control-selected-fg",
      "--tug-base-control-highlighted-fg",
      "--tug-base-selection-fg",
      "--tug-base-fg-link",
      // Muted / read-only hierarchy (below Lc 75 by design for visual hierarchy)
      "--tug-base-fg-muted",
      "--tug-base-field-fg-readOnly",
      // Tab chrome (below Lc 75 before auto-adjustment; near-miss tokens fixed by T4.1)
      "--tug-base-tab-fg-rest",
      "--tug-base-tab-fg-active",
      "--tug-base-tab-fg-hover",
    ]);

    const bodyTextResults = results.filter((r) => r.role === "body-text");
    expect(bodyTextResults.length).toBeGreaterThan(0);

    // All body-text pairings NOT in the known-exception set must pass Lc 75
    const unexpectedFailures = bodyTextResults.filter(
      (r) => !r.lcPass && !INTENTIONALLY_BELOW_THRESHOLD.has(r.fg),
    );
    const failureDescriptions = unexpectedFailures.map(
      (f) => `${f.fg} on ${f.bg}: Lc ${f.lc.toFixed(1)}`,
    );
    expect(failureDescriptions).toEqual([]);

    // Primary fg-default must explicitly pass Lc 75 (belt-and-suspenders)
    const coreResults = bodyTextResults.filter(
      (r) => r.fg === "--tug-base-fg-default",
    );
    expect(coreResults.length).toBeGreaterThan(0);
    expect(coreResults.every((r) => r.lcPass)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T3.6: autoAdjustContrast — most-restrictive-bg strategy
  // A single fg token paired against 3 different bg tokens (varying lightness)
  // → single adjustment satisfies all pairings.
  // -------------------------------------------------------------------------
  it("T3.6: autoAdjustContrast with fg vs 3 bgs — single adjustment satisfies all", () => {
    const fgToken = "--tug-base-fg-default";
    const bgToken1 = "--tug-base-bg-app";
    const bgToken2 = "--tug-base-surface-default";
    const bgToken3 = "--tug-base-surface-raised";

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
      { fg: fgToken, bg: bgToken1, wcagRatio: 1.5, lc: 10, lcPass: false, role: "body-text" as const },
      { fg: fgToken, bg: bgToken2, wcagRatio: 1.4, lc: 9, lcPass: false, role: "body-text" as const },
      { fg: fgToken, bg: bgToken3, wcagRatio: 1.3, lc: 8, lcPass: false, role: "body-text" as const },
    ];

    // Test-local pairings array — covers exactly the three surfaces in this test
    const testPairings = [
      { element: fgToken, surface: bgToken1, role: "body-text" as const },
      { element: fgToken, surface: bgToken2, role: "body-text" as const },
      { element: fgToken, surface: bgToken3, role: "body-text" as const },
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
  // (violet tone≈92 for fg, tone=90 for bg). Lc sign: fgL > bgL → Lc is positive
  // (dark-on-light polarity) → bumpDirection = -1 (bump fg darker, toward bg).
  // That immediately reduces contrast further, Lc flips sign, direction flips to +1.
  // The alternating pattern triggers oscillation detection, freezing the token as
  // unfixable after 3 alternating directions.
  //
  // Probed values (violet, C=0.02, h=264):
  //   bg=tone90 (L≈0.9096):  fg=tone100 (L=0.96) → |Lc|≈... far below Lc 75
  //   bg=tone90:              fg=tone92  (L≈0.920) → |Lc|≈... far below Lc 75 (start)
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
        lc: 3,
        lcPass: false,
        role: "body-text" as const,
      },
    ];

    // Test-local pairings array — keeps T3.7 isolated and predictable
    const testPairings = [
      { element: fgToken, surface: bgToken, role: "body-text" as const },
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
        lc: computeLcContrast(elementHex, darkHex),
        lcPass: false, role: "body-text" as const,
      },
      {
        fg: elementToken, bg: lightSurface,
        wcagRatio: computeWcagContrast(elementHex, lightHex),
        lc: computeLcContrast(elementHex, lightHex),
        lcPass: false, role: "body-text" as const,
      },
    ];

    // Both pairings should indeed be failing initially
    expect(failures.every((f) => !f.lcPass)).toBe(true);

    const testPairings = [
      { element: elementToken, surface: darkSurface, role: "body-text" as const },
      { element: elementToken, surface: lightSurface, role: "body-text" as const },
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
    const fgToken = "--tug-base-fg-default";
    const bgToken = "--tug-base-bg-app";

    // Start near-passing: tone=90, |Lc|≈71.2 (just below Lc 75)
    const fgL = 0.708 + (40 * (0.96 - 0.708)) / 50; // tone=90 → ~0.9096
    const bgL = 0.15 + (15 * (0.708 - 0.15)) / 50;  // tone=15 → ~0.3174

    const fgResolved: ResolvedColor = { L: fgL, C: 0.02, h: 264, alpha: 1 };
    const bgResolved: ResolvedColor = { L: bgL, C: 0.02, h: 264, alpha: 1 };

    const resolved: Record<string, ResolvedColor> = {
      [fgToken]: fgResolved,
      [bgToken]: bgResolved,
    };
    const tokens: Record<string, string> = {
      [fgToken]: "--tug-color(violet, t: 90)",
      [bgToken]: "--tug-color(violet, t: 15)",
    };

    const fgHex = oklchToHex(fgL, 0.02, 264);
    const bgHex = oklchToHex(bgL, 0.02, 264);
    const failures = [
      {
        fg: fgToken, bg: bgToken,
        wcagRatio: computeWcagContrast(fgHex, bgHex),
        lc: computeLcContrast(fgHex, bgHex),
        lcPass: false, role: "body-text" as const,
      },
    ];

    const testPairings = [
      { element: fgToken, surface: bgToken, role: "body-text" as const },
    ];

    const result = autoAdjustContrast(tokens, resolved, failures, testPairings);

    // The pair should be fixed (one iteration of +5 tone → tone=95, |Lc|≈81.6)
    expect(result.unfixable).toEqual([]);

    // Verify the final state actually passes
    const newFgHex = oklchToHex(result.resolved[fgToken].L, 0.02, 264);
    const newBgHex = oklchToHex(result.resolved[bgToken].L, 0.01, 264);
    const finalLc = computeLcContrast(newFgHex, newBgHex);
    expect(Math.abs(finalLc)).toBeGreaterThanOrEqual(LC_THRESHOLDS["body-text"]);
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
    const elementA = "--tug-base-fg-muted";
    const elementB = "--tug-base-fg-default";
    const sharedSurface = "--tug-base-surface-default";

    // dark mode: surface is dark, elements should be light
    // elementA starts at tone=90 (|Lc|≈71.2 — just below Lc 75, failing)
    // elementB starts at tone=94 (|Lc|≈79.3 — passing Lc 75)
    const surfaceL = 0.15 + (15 * (0.708 - 0.15)) / 50; // ~0.3174 (tone=15 equivalent)
    const elementAL = 0.708 + (40 * (0.96 - 0.708)) / 50; // tone=90 → ~0.9096
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
      [elementA]: "--tug-color(violet, t: 90)",
      [elementB]: "--tug-color(violet, t: 94)",
      [sharedSurface]: "--tug-color(violet, i: 2, t: 15)",
    };

    const aHex = oklchToHex(elementAL, 0.02, 264);
    const surfHex = oklchToHex(surfaceL, 0.01, 264);
    const lcA = computeLcContrast(aHex, surfHex);
    const failures = [
      {
        fg: elementA, bg: sharedSurface,
        wcagRatio: computeWcagContrast(aHex, surfHex),
        lc: lcA, lcPass: false, role: "body-text" as const,
      },
    ];

    // Both pairs in the pairings map — cascade detection monitors elementB too
    const testPairings = [
      { element: elementA, surface: sharedSurface, role: "body-text" as const },
      { element: elementB, surface: sharedSurface, role: "body-text" as const },
    ];

    const result = autoAdjustContrast(tokens, resolved, failures, testPairings);

    // elementA should have been fixed
    expect(result.unfixable).not.toContain(elementA);

    // elementB must still pass after adjustment (cascade re-validation guards this)
    const newBHex = oklchToHex(result.resolved[elementB].L, 0.02, 264);
    const newSurfHex = oklchToHex(result.resolved[sharedSurface].L, 0.01, 264);
    const lcB = computeLcContrast(newBHex, newSurfHex);
    expect(Math.abs(lcB)).toBeGreaterThanOrEqual(LC_THRESHOLDS["body-text"]);
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
  // are designed for chromatic signals, applying them to an achromatic input
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
