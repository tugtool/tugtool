#!/usr/bin/env bun
/**
 * apply-theme-editor.ts — re-hue a theme's Key (selection/action) and Accent
 * (affordance) axes to a chosen TugColor hue, scaling chroma by a factor.
 *
 * Computes every token absolutely from an identity-space baseline recipe, kept
 * live by diff-merging hand edits to the .css back in (so repeated applies never
 * compound and hand tuning survives). Shares the transform and the per-theme
 * state file with the dev-server POST /__theme-editor/apply endpoint via
 * theme-editor-core.ts.
 *
 * Usage:
 *   bun run scripts/apply-theme-editor.ts <theme> <keyHue> <keyScale> <accentHue> <accentScale> [keyToneShift] [accentToneShift]
 *   bun run scripts/apply-theme-editor.ts brio cobalt 0.90 orange 0.85
 *   bun run scripts/apply-theme-editor.ts aria purple 0.50 sky 0.90 -6 4
 */

import fs from "fs";
import path from "path";
import {
  applyDuet,
  diffMergeBaseline,
  extractBaseline,
  identitySeed,
  isKnownHue,
  type DuetSeed,
} from "../theme-editor-core";

interface ThemeEditorEntry {
  identityBaseline: Record<string, string>;
  appliedSeed: DuetSeed;
  lastGenCss: string;
}
type ThemeEditorState = Record<string, ThemeEditorEntry>;

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
const statePath = path.join(themesDir, "theme-editor-state.json");

if (!fs.existsSync(themeFile)) {
  console.error(`no theme file: ${themeFile}`);
  process.exit(1);
}

const state: ThemeEditorState = (() => {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8")) as ThemeEditorState;
  } catch {
    return {};
  }
})();

const current = fs.readFileSync(themeFile, "utf-8");
const prior = state[theme] ?? {
  identityBaseline: extractBaseline(current),
  appliedSeed: identitySeed(),
  lastGenCss: current,
};
const baseline = diffMergeBaseline(current, prior.lastGenCss, prior.identityBaseline, prior.appliedSeed);
const { css, keyCount, accentCount } = applyDuet(current, baseline, seed);
fs.writeFileSync(themeFile, css);
state[theme] = { identityBaseline: baseline, appliedSeed: seed, lastGenCss: css };
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
console.log(
  `${theme}: re-hued ${keyCount} Key -> ${keyHue} (x${seed.keyScale}), ${accentCount} Accent -> ${accentHue} (x${seed.accentScale})`,
);
