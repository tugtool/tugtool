#!/usr/bin/env bun
/**
 * apply-duet.ts — re-hue a theme's Key (selection/action) and Accent (affordance)
 * axes to a chosen TugColor hue, scaling chroma by the locked workshop factor.
 *
 * Operates on --tug-color(...) token values by ROLE NAME, keeping each token's
 * tone + alpha (so per-theme / per-mode lightness — e.g. light themes' darker
 * links — is preserved) and only swapping the hue + scaling intensity. Achromatic
 * washes (white/black/gray) and the signal / neutral-tint / incidental tokens are
 * left untouched.
 *
 * Usage:
 *   bun run scripts/apply-duet.ts <theme> <keyHue> <keyScale> <accentHue> <accentScale>
 *   bun run scripts/apply-duet.ts brio cobalt 0.90 orange 0.85
 *
 * Idempotent per (theme, hues, scales): re-running with the same args is a no-op
 * for already-converted tokens only if the scale is reapplied to original
 * intensities — so run ONCE per theme from a clean (un-rehued) theme file.
 */

import fs from "fs";
import path from "path";
import { HUE_FAMILIES, TUG_COLOR_PRESETS } from "../src/components/tugways/palette-engine";

const CHROMATIC = new Set(Object.keys(HUE_FAMILIES));

// ---- Role classification by token name -------------------------------------

/** Tokens excluded from any re-hue (signals, neutral tint, on-fill text, incidental). */
function isExcluded(name: string): boolean {
  return (
    name.includes("selection-text") ||           // on-fill contrast text — stays neutral
    name.includes("plain-inactive") ||            // achromatic inactive wash
    name.includes("demoted-danger") ||
    name.includes("demoted-data") ||
    name.includes("demoted-agent") ||
    name.includes("-atom-") ||                    // @-mention chip component identity
    name.includes("ansi") ||                      // terminal ANSI literals
    name.includes("-option-") ||                  // option role (neutral picker)
    name.includes("confirmed") ||                 // post-confirm success state stays green
    name.includes("inspector") ||                 // dev-overlay highlights
    name.includes("preview") ||
    name.includes("snap") ||
    name.includes("findmatch")                    // search has its own yellow/orange identity
  );
}

/** Key = the selection / primary-action axis. */
function isKey(name: string): boolean {
  if (
    name.includes("selection-primary-normal-plain-rest") ||
    name.includes("selection-primary-normal-selected-rest") ||
    name.includes("selection-primary-normal-selected-hover") ||
    name.includes("selection-primary-normal-quiet-rest") ||
    name.includes("selection-primary-normal-quiet-hover") ||
    name.includes("selection-primary-normal-quiet-strong") ||
    name.includes("selection-primary-demoted-action")
  ) return true;
  if (name.includes("-tone-") && name.includes("-active-rest")) return true; // tone family "active"
  if (name.includes("text-normal-link-rest") || name.includes("text-normal-link-hover")) return true;
  if (name.includes("-action-")) return true;       // control + badge action role (any emphasis)
  if (name.includes("toggle-") && (name.includes("-on-") || name.includes("-active-"))) return true;
  if (name.includes("-normal-highlighted") || name.includes("-normal-selected")) return true;
  if (name.includes("slider-fill-normal-range")) return true;
  if (name.includes("field-border-normal-plain-active")) return true;
  if (name.includes("-drop") && !name.includes("stroke")) return true; // drop-target fill/surface (stroke is Accent)
  return false;
}

/** Accent = the affordance axis. */
function isAccent(name: string): boolean {
  if (name.includes("-accent")) return true;        // global/tone/control/badge/toggle accent + accentCool + accentSubtle
  if (name.includes("highlight-stroke-normal-drop")) return true;
  if (name.includes("shadow-normal-flash")) return true;
  if (name.includes("highlight-primary-normal-flash")) return true;
  return false;
}

// ---- --tug-color() rewrite -------------------------------------------------

interface Parsed { hue: string; i: number; t: number; a: number | null; }

function parseTugColor(inner: string): Parsed | null {
  // inner like: "blue, i: 84, t: 44, a: 24"  or  "blue"  or  "blue-light"  or  "orange, t: 47"
  const parts = inner.split(",").map((s) => s.trim());
  let head = parts[0];
  let i = 50;
  let t = 50;
  let a: number | null = null;
  // preset suffix on the head (e.g. blue-light) — expand to i/t defaults.
  const segs = head.split("-");
  let hue = segs[0];
  for (let k = 1; k < segs.length; k++) {
    const preset = TUG_COLOR_PRESETS[segs[k]];
    if (preset) {
      i = preset.intensity;
      t = preset.tone;
    } else {
      // adjacency (e.g. indigo-violet) — keep only the primary hue for re-hue.
    }
  }
  for (const p of parts.slice(1)) {
    const m = p.match(/^([ita])\s*:\s*([\d.]+)$/);
    if (!m) continue;
    if (m[1] === "i") i = parseFloat(m[2]);
    if (m[1] === "t") t = parseFloat(m[2]);
    if (m[1] === "a") a = parseFloat(m[2]);
  }
  if (!CHROMATIC.has(hue)) return null; // achromatic / unknown — skip
  return { hue, i, t, a };
}

function formatTugColor(hue: string, i: number, t: number, a: number | null): string {
  const ri = Math.round(i);
  const parts = [`i: ${ri}`, `t: ${t}`];
  if (a !== null) parts.push(`a: ${a}`);
  return `--tug-color(${hue}, ${parts.join(", ")})`;
}

// ---- Main ------------------------------------------------------------------

const [, , theme, keyHue, keyScaleStr, accentHue, accentScaleStr] = process.argv;
if (!theme || !keyHue || !keyScaleStr || !accentHue || !accentScaleStr) {
  console.error("usage: apply-duet.ts <theme> <keyHue> <keyScale> <accentHue> <accentScale>");
  process.exit(1);
}
const keyScale = parseFloat(keyScaleStr);
const accentScale = parseFloat(accentScaleStr);

const file = path.resolve(import.meta.dir, "..", "styles", "themes", `${theme}.css`);
const src = fs.readFileSync(file, "utf-8");
const lines = src.split("\n");

let keyCount = 0;
let accentCount = 0;

const out = lines.map((line) => {
  const defMatch = line.match(/^(\s*)(--tug7-[\w-]+)\s*:\s*(--tug-color\(([^)]*)\))\s*;(.*)$/);
  if (!defMatch) return line;
  const [, indent, name, , inner, trailing] = defMatch;
  if (isExcluded(name)) return line;
  const role = isKey(name) ? "key" : isAccent(name) ? "accent" : null;
  if (!role) return line;
  const parsed = parseTugColor(inner);
  if (!parsed) return line; // achromatic wash — leave (e.g. white a:10 hovers)
  const hue = role === "key" ? keyHue : accentHue;
  const scale = role === "key" ? keyScale : accentScale;
  const rewritten = formatTugColor(hue, parsed.i * scale, parsed.t, parsed.a);
  if (role === "key") keyCount++;
  else accentCount++;
  return `${indent}${name}: ${rewritten};${trailing}`;
});

fs.writeFileSync(file, out.join("\n"));
console.log(`${theme}: re-hued ${keyCount} Key -> ${keyHue} (x${keyScale}), ${accentCount} Accent -> ${accentHue} (x${accentScale})`);
