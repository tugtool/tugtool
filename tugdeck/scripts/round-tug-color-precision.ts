/**
 * round-tug-color-precision — round authored --tug-color() l/c/a to 2 decimals.
 *
 * Four-decimal chroma/lightness carries no human-perceivable benefit. This rounds
 * every recipe's lightness, chroma, and alpha to at most 2 decimals (trailing zeros
 * stripped), in place, touching only the numeric tokens.
 *
 * Chroma is rounded gamut-safely: rounding to nearest can nudge a value that sits at
 * the P3 ceiling just past it, so after rounding (and after the lightness round, which
 * also shifts the ceiling) the color is re-checked against P3 and the chroma stepped
 * down by 0.01 until it fits. So the pass preserves the in-P3 invariant — audit:gamut
 * stays at zero out-of-P3.
 *
 * Usage:
 *   bun run scripts/round-tug-color-precision.ts            # dry run: count + sample
 *   bun run scripts/round-tug-color-precision.ts --write    # apply in place
 */

import fs from "fs";
import path from "path";
import {
  HUE_FAMILIES,
  NAMED_GRAYS,
  ADJACENCY_RING,
  resolveTugColorToOklch,
  isInP3Gamut,
} from "../src/components/tugways/palette-engine";
import { parseTugColor, findTugColorCallsWithWarnings } from "../tug-color-parser";

const TUGDECK = path.resolve(import.meta.dir, "..");

const TARGET_FILES = [
  "styles/themes/aria.css",
  "styles/themes/bravura.css",
  "styles/themes/brio.css",
  "styles/themes/harmony.css",
  "styles/themes/nocturne.css",
  "styles/themes/vivace.css",
  "styles/tug.css",
  "src/components/tugways/tug-code.css",
  "src/components/tugways/tug-data.css",
  "src/components/tugways/tug-dialog.css",
  "src/components/tugways/tug-dock.css",
];

const KNOWN_HUES: ReadonlySet<string> = new Set([
  ...Object.keys(HUE_FAMILIES),
  "black", "white", "gray", "transparent",
  ...NAMED_GRAYS,
]);

const round2 = (n: number): number => Math.round(n * 100) / 100;
/** ≤2-decimal string, trailing zeros stripped (0.40 → "0.4", 0.20 → "0.2"). */
const fmt2 = (n: number): string => parseFloat(round2(n).toFixed(2)).toString();

interface Stats { calls: number; changed: number; }

function roundFile(rel: string, write: boolean, stats: Stats, sample: string[]): void {
  const abs = path.join(TUGDECK, rel);
  const src = fs.readFileSync(abs, "utf-8");
  const { calls } = findTugColorCallsWithWarnings(src);
  if (calls.length === 0) return;

  let result = src;
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];
    const parsed = parseTugColor(call.inner, KNOWN_HUES, ADJACENCY_RING);
    if (!parsed.ok) continue;
    stats.calls++;
    const { color, lightness, chroma, alpha } = parsed.value;
    const { L, C, h } = resolveTugColorToOklch(color.name, color.adjacentName, lightness, chroma, alpha);

    const hasL = /\bl:/.test(call.inner);
    const hasC = /\bc:/.test(call.inner);
    const hasA = /\ba:/.test(call.inner);

    const Lr = hasL ? round2(lightness) : L;
    let Cr = round2(chroma);
    // Keep chroma within P3 at the (possibly rounded) lightness.
    if (hasC && Cr > 0) {
      while (Cr > 0 && !isInP3Gamut(Lr, Cr, h)) Cr = round2(Cr - 0.01);
    }

    let inner = call.inner;
    if (hasL) inner = inner.replace(/\bl:\s*[0-9.]+/, `l: ${fmt2(lightness)}`);
    if (hasC) inner = inner.replace(/\bc:\s*[0-9.]+/, `c: ${fmt2(Cr)}`);
    if (hasA) inner = inner.replace(/\ba:\s*[0-9.]+/, `a: ${fmt2(alpha)}`);

    const replacement = `--tug-color(${inner})`;
    const original = result.slice(call.start, call.end);
    if (replacement === original) continue;
    if (sample.length < 6) sample.push(`  ${original}\n    → ${replacement}`);
    result = result.slice(0, call.start) + replacement + result.slice(call.end);
    stats.changed++;
  }

  if (write && result !== src) fs.writeFileSync(abs, result, "utf-8");
}

function main(): void {
  const write = process.argv.includes("--write");
  const stats: Stats = { calls: 0, changed: 0 };
  const sample: string[] = [];
  console.log(write ? "Rounding l/c/a to 2 decimals (writing in place)\n" : "DRY RUN — round l/c/a to 2 decimals (no files written)\n");
  for (const rel of TARGET_FILES) roundFile(rel, write, stats, sample);
  if (sample.length) console.log(sample.join("\n") + "\n");
  console.log(`${stats.calls} calls, ${stats.changed} rounded.`);
  if (!write) console.log("\nRe-run with --write to apply.");
}

main();
