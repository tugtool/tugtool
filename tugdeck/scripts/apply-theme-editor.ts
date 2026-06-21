#!/usr/bin/env bun
/**
 * apply-theme-editor.ts — re-hue a theme's Key (selection/action) and Accent
 * (affordance) axes to a chosen TugColor hue, scaling chroma by a factor.
 *
 * Computes every token absolutely from the clean baseline recipe
 * (styles/themes/theme-editor-baseline.json), so repeated applies never compound.
 * Shares the transform with the dev-server POST /__theme-editor/apply endpoint via
 * theme-editor-core.ts.
 *
 * Usage:
 *   bun run scripts/apply-theme-editor.ts <theme> <keyHue> <keyScale> <accentHue> <accentScale> [keyToneShift] [accentToneShift]
 *   bun run scripts/apply-theme-editor.ts brio cobalt 0.90 orange 0.85
 *   bun run scripts/apply-theme-editor.ts aria purple 0.50 sky 0.90 -6 4
 */

import fs from "fs";
import path from "path";
import { applyDuet, isKnownHue, type DuetSeed } from "../theme-editor-core";

const [, , theme, keyHue, keyScaleStr, accentHue, accentScaleStr, keyToneStr, accentToneStr] =
  process.argv;
if (!theme || !keyHue || !keyScaleStr || !accentHue || !accentScaleStr) {
  console.error("usage: apply-theme-editor.ts <theme> <keyHue> <keyScale> <accentHue> <accentScale> [keyToneShift] [accentToneShift]");
  process.exit(1);
}
if (!isKnownHue(keyHue) || !isKnownHue(accentHue)) {
  console.error(`unknown hue: ${isKnownHue(keyHue) ? accentHue : keyHue}`);
  process.exit(1);
}

const seed: DuetSeed = {
  keyHue,
  keyScale: parseFloat(keyScaleStr),
  keyToneShift: keyToneStr ? parseFloat(keyToneStr) : 0,
  accentHue,
  accentScale: parseFloat(accentScaleStr),
  accentToneShift: accentToneStr ? parseFloat(accentToneStr) : 0,
};

const themesDir = path.resolve(import.meta.dir, "..", "styles", "themes");
const themeFile = path.join(themesDir, `${theme}.css`);
const baselinePath = path.join(themesDir, "theme-editor-baseline.json");

if (!fs.existsSync(themeFile)) {
  console.error(`no theme file: ${themeFile}`);
  process.exit(1);
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8")) as Record<
  string,
  Record<string, string>
>;
if (!baseline[theme]) {
  console.error(`no baseline for theme "${theme}"`);
  process.exit(1);
}

const current = fs.readFileSync(themeFile, "utf-8");
const { css, keyCount, accentCount } = applyDuet(current, baseline[theme], seed);
fs.writeFileSync(themeFile, css);
console.log(
  `${theme}: re-hued ${keyCount} Key -> ${keyHue} (x${seed.keyScale}), ${accentCount} Accent -> ${accentHue} (x${seed.accentScale})`,
);
