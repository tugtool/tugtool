#!/usr/bin/env bun
/**
 * derive-theme.ts — generate a theme family member from a canonical base theme
 * by rotating its brand hues, preserving each token's perceived chroma + lightness.
 *
 * The base (e.g. brio dark, harmony light) is hand-tuned once; deriving rotates
 * its Key/Accent brand hues to new ones at the i/t that hold the same absolute
 * OKLCH C / L — so the derived theme reads exactly like the base, just a different
 * hue (the family-from-one-base model). Signals, syntax and grays are untouched.
 *
 * Usage:
 *   bun run scripts/derive-theme.ts <base> <out> <keyHue> [accentHue] [--dry]
 *   bun run scripts/derive-theme.ts brio nocturne seafoam
 *   bun run scripts/derive-theme.ts harmony aria violet amber
 */

import fs from "fs";
import path from "path";
import { deriveTheme, isKnownHue } from "../theme-editor-core";
import { correctThemeContrast } from "./theme-contrast-correct";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [base, out, keyHue, accentHue] = args.filter((a) => a !== "--dry");

if (!base || !out || !keyHue) {
  console.error("usage: derive-theme.ts <base> <out> <keyHue> [accentHue] [--dry]");
  process.exit(1);
}
if (!isKnownHue(keyHue) || (accentHue && !isKnownHue(accentHue))) {
  console.error(`unknown hue: ${isKnownHue(keyHue) ? accentHue : keyHue}`);
  process.exit(1);
}

const themesDir = path.resolve(import.meta.dir, "..", "styles", "themes");
const baseFile = path.join(themesDir, `${base}.css`);
const outFile = path.join(themesDir, `${out}.css`);

if (!fs.existsSync(baseFile)) {
  console.error(`no base theme: ${baseFile}`);
  process.exit(1);
}

const baseCss = fs.readFileSync(baseFile, "utf-8");
const { css, count, baseKeyHue, baseAccentHue } = deriveTheme(baseCss, keyHue, accentHue);

const accentTo = accentHue ?? baseAccentHue ?? keyHue;
console.log(
  `${base} → ${out}: rotated ${count} tokens ` +
    `(Key ${baseKeyHue} → ${keyHue}, Accent ${baseAccentHue} → ${accentTo})`,
);

if (dry) {
  console.log("(dry run — no file written)");
} else {
  fs.writeFileSync(outFile, css);
  console.log(`wrote ${outFile}`);

  // Hue rotation preserves perceptual lightness but not WCAG luminance, so a
  // rotated contrast-bearing rung can land below its floor. Repair just those
  // rungs (tone-only) against the base, in place.
  const correction = correctThemeContrast(outFile, baseFile, { apply: true });
  if (correction.corrected.length > 0) {
    console.log(
      `gamut-corrected ${correction.corrected.length} rung(s) ` +
        `(${correction.before} → ${correction.after} WCAG fail, budget ${correction.budget}):`,
    );
    for (const c of correction.corrected) {
      console.log(`  ${c.token}: ${c.hue} tone ${c.fromTone} → ${c.toTone}`);
    }
  }
  for (const u of correction.uncorrectable) {
    console.warn(
      `  WARNING uncorrectable overrun: ${u.fg} on ${u.bg} ` +
        `(${u.role}, WCAG ${u.wcag.toFixed(2)}) — left for manual tuning`,
    );
  }
}
