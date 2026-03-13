/**
 * Theme accessibility tests — pairing map completeness and validity.
 *
 * Covers:
 * - T1.1: FG_BG_PAIRING_MAP contains entries for all chromatic fg tokens
 * - T1.2: Every entry has a valid `role` from the allowed set
 * - T1.3: No duplicate pairs
 *
 * Run with: cd tugdeck && bun test -- --grep "pairing-map"
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "bun:test";

import { FG_BG_PAIRING_MAP, ContrastRole } from "@/components/tugways/fg-bg-pairing-map";

// ---------------------------------------------------------------------------
// CSS parsing helpers
// ---------------------------------------------------------------------------

const STYLES_DIR = join(import.meta.dir, "../../styles");

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
      name.includes("range-thumb") ||
      name.includes("range-value") ||
      name.includes("toggle-thumb") ||
      name.includes("-scrollbar-thumb");

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
      !name.endsWith("-value") &&
      !name.endsWith("-tick") &&
      !name.endsWith("-annotation") &&
      !name.endsWith("-shortcut") &&
      !name.endsWith("-meta") &&
      !name.endsWith("-counter") &&
      !name.endsWith("-limit") &&
      !name.endsWith("-dirty") &&
      !name.endsWith("-required") &&
      !name.endsWith("-error") &&
      !name.endsWith("-warning") &&
      !name.endsWith("-success") &&
      !name.endsWith("-helper") &&
      !name.endsWith("-readOnly") &&
      !name.endsWith("-focus-ring-default") &&
      !name.endsWith("-focus-ring-danger") &&
      !name.endsWith("-focus-ring-offset");

    const isBg =
      isNotFgOrBorder &&
      (name.includes("-bg") ||
        name.includes("-surface") ||
        name.includes("selection-bg") ||
        name.includes("avatar-bg") ||
        name.includes("tone-positive-bg") ||
        name.includes("tone-warning-bg") ||
        name.includes("tone-danger-bg") ||
        name.includes("tone-info-bg") ||
        name.includes("accent-bg") ||
        name.includes("accent-default") ||
        name.includes("accent-strong") ||
        name.includes("accent-muted") ||
        name.includes("accent-cool") ||
        name.includes("control-primary-bg") ||
        name.includes("control-secondary-bg") ||
        name.includes("control-destructive-bg") ||
        name.includes("control-disabled-bg") ||
        name.includes("control-selected-bg") ||
        name.includes("control-highlighted-bg") ||
        name.includes("field-bg") ||
        name.includes("toggle-track") ||
        name.includes("range-track") ||
        name.includes("range-fill") ||
        name.includes("range-scrub"));

    if (isFg) fgTokens.add(name);
    if (isBg) bgTokens.add(name);
  }

  return { fg: fgTokens, bg: bgTokens };
}

// ---------------------------------------------------------------------------
// Test suite: pairing-map completeness and validity
// ---------------------------------------------------------------------------

describe("pairing-map", () => {
  const css = readFileSync(join(STYLES_DIR, "tug-base.css"), "utf8");
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
    const mappedFgTokens = new Set(FG_BG_PAIRING_MAP.map((p) => p.fg));

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
    const mappedBgTokens = new Set(FG_BG_PAIRING_MAP.map((p) => p.bg));

    // Some bg tokens appear only as structural (bg-disabled uses var() ref)
    // or are semi-transparent overlays primarily used for layering, not direct
    // fg-over-bg pairings. These are expected to be absent from the map.
    const EXCLUDED_BG_TOKENS = new Set([
      // disabled bgs use var() references (structural pass-through); pairings
      // are covered via control-disabled-bg directly
      "--tug-base-control-primary-bg-disabled",
      "--tug-base-control-secondary-bg-disabled",
      "--tug-base-control-destructive-bg-disabled",
      "--tug-base-control-selected-disabled-bg",
      // semi-transparent overlays / highlights — not direct surface pairings
      // (these are additive overlays layered on top of surfaces)
      "--tug-base-highlight-hover",
      "--tug-base-highlight-dropTarget",
      "--tug-base-highlight-preview",
      "--tug-base-highlight-inspectorTarget",
      "--tug-base-highlight-snapGuide",
      "--tug-base-highlight-flash",
      "--tug-base-accent-bg-emphasis",
      "--tug-base-accent-bg-subtle",
      "--tug-base-accent-subtle",
      "--tug-base-accent-guide",
      "--tug-base-accent-flash",
      // selection-bg-inactive is decorative / no chromatic fg over it
      "--tug-base-selection-bg-inactive",
      // range-scrub is a semi-transparent overlay, not a direct surface
      "--tug-base-range-scrub-active",
      // ghost hover/active are semi-transparent whites (effectively overlays)
      "--tug-base-control-ghost-bg-hover",
      "--tug-base-control-ghost-bg-active",
      // selected-bg-hover is a slightly more opaque version of selected-bg
      "--tug-base-control-selected-bg-hover",
      // field-bg-disabled paired via field-fg-disabled
      "--tug-base-field-bg-disabled",
      // accent-muted is used as a decorative accent color, not a bg surface
      "--tug-base-accent-muted",
      // accent-cool-default is used as a focus ring / accent UI element
      "--tug-base-accent-cool-default",
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
    const invalidRoles: Array<{ fg: string; bg: string; role: string }> = [];
    for (const pairing of FG_BG_PAIRING_MAP) {
      if (!VALID_ROLES.has(pairing.role)) {
        invalidRoles.push({
          fg: pairing.fg,
          bg: pairing.bg,
          role: pairing.role,
        });
      }
    }
    expect(invalidRoles).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T1.3: No duplicate pairs
  // -------------------------------------------------------------------------
  it("T1.3: no duplicate fg/bg pairs", () => {
    const seen = new Set<string>();
    const duplicates: Array<{ fg: string; bg: string }> = [];
    for (const pairing of FG_BG_PAIRING_MAP) {
      const key = `${pairing.fg}|${pairing.bg}`;
      if (seen.has(key)) {
        duplicates.push({ fg: pairing.fg, bg: pairing.bg });
      }
      seen.add(key);
    }
    expect(duplicates).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Sanity: map is non-empty and has reasonable size
  // -------------------------------------------------------------------------
  it("has at least 50 pairings (sanity check)", () => {
    expect(FG_BG_PAIRING_MAP.length).toBeGreaterThan(50);
  });
});
