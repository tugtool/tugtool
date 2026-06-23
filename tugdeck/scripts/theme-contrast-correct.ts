#!/usr/bin/env bun
/**
 * theme-contrast-correct.ts — gamut-correct a derived theme's rotated rungs.
 *
 * `derive-theme.ts` rotates a base theme's Key/Accent brand hues while
 * preserving each token's absolute OKLCH C/L. That preserves *perceptual*
 * lightness, but WCAG relative luminance is green-weighted — so rotating a hue
 * across the wheel (e.g. brio's violet agent axis → nocturne's aqua) shifts the
 * rendered luminance and can drop a contrast-bearing rung below its WCAG floor,
 * even though the base passed. The audit then flags the derived theme as
 * exceeding the base's accessibility budget.
 *
 * This pass repairs exactly those rungs and nothing else. It audits the theme,
 * isolates the *overrun* — pairings that fail here but pass in the base — and,
 * for each overrun whose foreground is a single-hue `--tug-color(hue, i:, t:)`
 * recipe, nudges that token's TONE (lightness) by the minimal amount, in the
 * contrast-increasing direction, that clears its floor without regressing any
 * of the token's currently-passing pairings. Hue and chroma are untouched, so
 * the mark keeps its rotated identity — only its lightness is corrected back
 * into WCAG range. Base-inherited failures (the shared budget) are left alone.
 *
 * Reuses the audit engine (`auditTheme`, `buildDefs`, `resolveToken`) and the
 * runtime contrast checker (`validateThemeContrast`) as the oracle, so the
 * correction can never disagree with the gate that grades it.
 *
 * Usage (standalone, fixes a theme in place against the base):
 *   bun run scripts/theme-contrast-correct.ts nocturne
 *   bun run scripts/theme-contrast-correct.ts nocturne --dry
 *
 * Programmatic (called by derive-theme.ts after it writes the derived CSS):
 *   correctThemeContrast(outFile, baseFile, { apply: true })
 */

import fs from "fs";
import path from "path";

import {
  HUE_FAMILIES,
  resolveTugColorToOklch,
  ADJACENCY_RING,
  ACHROMATIC_SEQUENCE,
} from "../src/components/tugways/palette-engine";
import { parseTugColor, findTugColorCalls } from "../tug-color-parser";
import {
  validateThemeContrast,
  WCAG_CONTRAST_THRESHOLDS,
  type ResolvedColor,
} from "../src/components/tugways/theme-accessibility";
import {
  ELEMENT_SURFACE_PAIRING_MAP,
  type ElementSurfacePairing,
} from "../src/components/tugways/theme-pairings";
import { BASE_THEME_NAME } from "../src/theme-constants";
import {
  auditTheme,
  buildDefs,
  resolveToken,
  KNOWN_HUES,
  KNOWN_PRESETS,
} from "./audit-theme-contrast";

const THEMES_DIR = path.resolve(import.meta.dir, "..", "styles", "themes");

/** How far the tone may travel (0–100 scale) before we give up and report it. */
const MAX_TONE_STEP = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToneCorrection {
  token: string;
  hue: string;
  fromTone: number;
  toTone: number;
}

export interface CorrectionResult {
  /** Tokens whose tone was nudged back into WCAG range. */
  corrected: ToneCorrection[];
  /** Overrun pairings we could not repair (non-nudgeable recipe, or no tone clears). */
  uncorrectable: { fg: string; bg: string; role: string; wcag: number }[];
  /** WCAG failure counts before/after, and the base budget. */
  before: number;
  after: number;
  budget: number;
  /** True when the theme is within budget after correction. */
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pairKey = (fg: string, bg: string): string => `${fg}|${bg}`;
const wcagFloor = (role: string): number => WCAG_CONTRAST_THRESHOLDS[role] ?? 1.0;

/** Resolve every token the pairing map references for this theme's defs. */
function resolveAll(defs: Map<string, string>): Record<string, ResolvedColor> {
  const needed = new Set<string>();
  for (const p of ELEMENT_SURFACE_PAIRING_MAP) {
    needed.add(p.element);
    needed.add(p.surface);
    if (p.parentSurface) needed.add(p.parentSurface);
  }
  const resolved: Record<string, ResolvedColor> = {};
  for (const name of needed) {
    const color = resolveToken(name, defs);
    if (color) resolved[name] = color;
  }
  return resolved;
}

interface Recipe {
  hue: string;
  intensity: number;
  tone: number;
  alpha: number;
}

/**
 * Parse a token's value into a tone-nudgeable single-hue recipe, or null. Only
 * a lone `--tug-color(<chromatic-hue>, i:, t:[, a:])` with an explicit `t:`
 * label qualifies — adjacency pairs, achromatic grays, var() aliases and
 * positional-tone recipes are left for the exception path.
 */
function parseRecipe(value: string | undefined): Recipe | null {
  if (value === undefined || !value.includes("--tug-color(")) return null;
  const calls = findTugColorCalls(value);
  if (calls.length !== 1) return null;
  // An explicit `t:` is required so the CSS patch can target the tone unambiguously.
  if (!/\bt:\s*\d+/.test(calls[0].inner)) return null;
  const parsed = parseTugColor(
    calls[0].inner,
    KNOWN_HUES,
    KNOWN_PRESETS,
    ADJACENCY_RING,
    ACHROMATIC_SEQUENCE,
  );
  if (!parsed.ok) return null;
  const { color, intensity, tone, alpha } = parsed.value;
  // Single chromatic hue only — chroma must exist to carry the rotated identity.
  if (color.adjacentName !== undefined) return null;
  if (!(color.name in HUE_FAMILIES)) return null;
  return { hue: color.name, intensity, tone, alpha };
}

function resolveRecipeTone(recipe: Recipe, tone: number): ResolvedColor {
  const { L, C, h, alpha } = resolveTugColorToOklch(
    recipe.hue,
    undefined,
    recipe.intensity,
    tone,
    recipe.alpha,
  );
  return { L, C, h, alpha };
}

/**
 * Find the minimal-magnitude tone shift for `token` that clears every overrun
 * pairing it fronts without regressing any pairing it currently passes. Tries
 * each step outward, darker before lighter, so the smallest legible nudge wins.
 * Returns the new tone, or null if nothing within `MAX_TONE_STEP` qualifies.
 */
function findCorrectingTone(
  token: string,
  recipe: Recipe,
  resolved: Record<string, ResolvedColor>,
  overrunKeys: Set<string>,
): number | null {
  const pairings = ELEMENT_SURFACE_PAIRING_MAP.filter(
    (p) => p.element === token || p.surface === token,
  );
  // Snapshot which of those pairings pass today, so we never regress one.
  const currentlyPass = new Map<ElementSurfacePairing, boolean>();
  for (const p of pairings) {
    const [r] = validateThemeContrast(resolved, [p]);
    currentlyPass.set(p, r !== undefined && r.wcagRatio >= wcagFloor(p.role));
  }

  for (let step = 1; step <= MAX_TONE_STEP; step++) {
    for (const dir of [-1, 1]) {
      const tone = recipe.tone + dir * step;
      if (tone < 0 || tone > 100) continue;
      const trial = { ...resolved, [token]: resolveRecipeTone(recipe, tone) };
      let acceptable = true;
      for (const p of pairings) {
        const [r] = validateThemeContrast(trial, [p]);
        const pass = r !== undefined && r.wcagRatio >= wcagFloor(p.role);
        // Never turn a passing pairing into a failing one.
        if (currentlyPass.get(p) === true && !pass) {
          acceptable = false;
          break;
        }
        // Every overrun pairing this token fronts must now clear.
        if (overrunKeys.has(pairKey(p.element, p.surface)) && !pass) {
          acceptable = false;
          break;
        }
      }
      if (acceptable) return tone;
    }
  }
  return null;
}

/** Rewrite a token's `t: <n>` to `newTone` inside its own declaration. */
function patchTone(css: string, token: string, newTone: number): string {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${esc}\\s*:\\s*--tug-color\\([^;]*?\\bt:\\s*)\\d+`);
  return css.replace(re, `$1${newTone}`);
}

// ---------------------------------------------------------------------------
// Correction
// ---------------------------------------------------------------------------

/**
 * Repair `themeFile`'s budget overrun against `baseFile`. When `apply` is true
 * the corrected CSS is written back in place; otherwise the file is untouched
 * and the result reports what would change.
 */
export function correctThemeContrast(
  themeFile: string,
  baseFile: string,
  { apply }: { apply: boolean },
): CorrectionResult {
  const budget = auditTheme(baseFile).failures.length;
  const baseFailKeys = new Set(
    auditTheme(baseFile).failures.map((f) => pairKey(f.fg, f.bg)),
  );

  const before = auditTheme(themeFile).failures.length;

  const defs = buildDefs(themeFile);
  const resolved = resolveAll(defs);

  // Overrun = fails here, passes in base. The shared base failures are budget.
  const overrun = validateThemeContrast(resolved, ELEMENT_SURFACE_PAIRING_MAP)
    .filter((r) => r.wcagRatio < wcagFloor(r.role))
    .filter((r) => !baseFailKeys.has(pairKey(r.fg, r.bg)));
  const overrunKeys = new Set(overrun.map((r) => pairKey(r.fg, r.bg)));

  const corrected: ToneCorrection[] = [];
  const uncorrectable: CorrectionResult["uncorrectable"] = [];
  let css = fs.readFileSync(themeFile, "utf-8");

  // One pass over the distinct foreground tokens in the overrun.
  const seen = new Set<string>();
  for (const r of overrun) {
    if (seen.has(r.fg)) continue;
    seen.add(r.fg);

    const recipe = parseRecipe(defs.get(r.fg));
    if (recipe === null) {
      uncorrectable.push({ fg: r.fg, bg: r.bg, role: r.role, wcag: r.wcagRatio });
      continue;
    }
    const newTone = findCorrectingTone(r.fg, recipe, resolved, overrunKeys);
    if (newTone === null) {
      uncorrectable.push({ fg: r.fg, bg: r.bg, role: r.role, wcag: r.wcagRatio });
      continue;
    }
    // Commit into the live resolved map so a later token's search sees it.
    resolved[r.fg] = resolveRecipeTone(recipe, newTone);
    css = patchTone(css, r.fg, newTone);
    corrected.push({
      token: r.fg,
      hue: recipe.hue,
      fromTone: recipe.tone,
      toTone: newTone,
    });
  }

  if (apply && corrected.length > 0) {
    fs.writeFileSync(themeFile, css);
  }

  // Re-audit from the live resolved map (matches what was/would be written).
  const after = validateThemeContrast(resolved, ELEMENT_SURFACE_PAIRING_MAP).filter(
    (r) => r.wcagRatio < wcagFloor(r.role),
  ).length;

  return {
    corrected,
    uncorrectable,
    before,
    after,
    budget,
    ok: after <= budget,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const themeArg = args.find((a) => !a.startsWith("--"));
  if (!themeArg) {
    console.error("usage: theme-contrast-correct.ts <theme> [--dry]");
    process.exit(1);
  }
  const themeFile = path.join(THEMES_DIR, `${themeArg}.css`);
  const baseFile = path.join(THEMES_DIR, `${BASE_THEME_NAME}.css`);
  if (!fs.existsSync(themeFile)) {
    console.error(`no theme: ${themeFile}`);
    process.exit(1);
  }

  const res = correctThemeContrast(themeFile, baseFile, { apply: !dry });
  console.log(
    `${themeArg}: ${res.before} → ${res.after} WCAG failure(s) ` +
      `(budget ${res.budget}) — ${res.ok ? "within budget" : "STILL OVER"}` +
      `${dry ? " (dry run — no file written)" : ""}`,
  );
  for (const c of res.corrected) {
    console.log(`  corrected ${c.token}`);
    console.log(`    ${c.hue} tone ${c.fromTone} → ${c.toTone}`);
  }
  for (const u of res.uncorrectable) {
    console.log(`  UNCORRECTABLE ${u.fg} on ${u.bg} (${u.role}, WCAG ${u.wcag.toFixed(2)})`);
  }
  process.exit(res.ok ? 0 : 1);
}
