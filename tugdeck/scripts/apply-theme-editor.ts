#!/usr/bin/env bun
/**
 * apply-theme-editor.ts — re-hue a theme's Key (selection/action) and Accent
 * (affordance) axes to a chosen TugColor hue, with additive intensity/tone
 * deltas off each rung's base (tug-color units, NOT a chroma multiplier).
 *
 * Computes every token absolutely from an identity-space baseline recipe, kept
 * live by diff-merging hand edits to the .css back in (so repeated applies never
 * compound and hand tuning survives). Shares the transform and the per-theme
 * state file with the dev-server POST /__theme-editor/apply endpoint via
 * theme-editor-core.ts.
 *
 * Usage:
 *   bun run scripts/apply-theme-editor.ts <theme> <keyHue> <keyIDelta> <accentHue> <accentIDelta> [keyTDelta] [accentTDelta]
 *   bun run scripts/apply-theme-editor.ts brio cobalt -4 orange -6
 *   bun run scripts/apply-theme-editor.ts aria purple 0 sky 0 -6 4
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

const [, , theme, keyHue, keyIStr, accentHue, accentIStr, keyTStr, accentTStr] =
  process.argv;
if (!theme || !keyHue || keyIStr === undefined || !accentHue || accentIStr === undefined) {
  console.error("usage: apply-theme-editor.ts <theme> <keyHue> <keyIDelta> <accentHue> <accentIDelta> [keyTDelta] [accentTDelta]");
  process.exit(1);
}
if (!isKnownHue(keyHue) || !isKnownHue(accentHue)) {
  console.error(`unknown hue: ${isKnownHue(keyHue) ? accentHue : keyHue}`);
  process.exit(1);
}

const seed: DuetSeed = {
  keyHue,
  key: { iDelta: parseFloat(keyIStr), tDelta: keyTStr ? parseFloat(keyTStr) : 0, aDelta: 0 },
  accentHue,
  accent: { iDelta: parseFloat(accentIStr), tDelta: accentTStr ? parseFloat(accentTStr) : 0, aDelta: 0 },
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
  `${theme}: re-hued ${keyCount} Key -> ${keyHue} (i${seed.key.iDelta >= 0 ? "+" : ""}${seed.key.iDelta}, t${seed.key.tDelta >= 0 ? "+" : ""}${seed.key.tDelta}), ` +
    `${accentCount} Accent -> ${accentHue} (i${seed.accent.iDelta >= 0 ? "+" : ""}${seed.accent.iDelta}, t${seed.accent.tDelta >= 0 ? "+" : ""}${seed.accent.tDelta})`,
);
