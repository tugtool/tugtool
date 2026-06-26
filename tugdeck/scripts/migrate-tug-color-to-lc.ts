/**
 * migrate-tug-color-to-lc — Rewrite --tug-color() calls from the intensity/tone
 * authoring model to direct oklch lightness/chroma.
 *
 * For every --tug-color(...) call in the target CSS files, this resolves the call
 * with the CURRENT engine (resolveTugColorToOklch — the ground truth that postcss
 * bakes today) and re-emits it in the new l:/c: form, keeping the hue name and any
 * adjacency intact:
 *
 *   --tug-color(indigo, i: 3, t: 94)      → --tug-color(indigo, l: 0.9189, c: 0.0084)
 *   --tug-color(cobalt-indigo, i: 5, t: 14) → --tug-color(cobalt-indigo, l: 0.2..., c: 0.0...)
 *   --tug-color(coral-muted)              → --tug-color(coral, l: ..., c: ...)   (preset expanded)
 *   --tug-color(charcoal)                 → --tug-color(charcoal)                (fixed gray, unchanged)
 *   --tug-color(gray, t: 40)              → --tug-color(gray, l: 0.43)
 *   --tug-color(paper-linen)              → --tug-color(gray, l: 0.8067)         (achromatic adjacency)
 *   --tug-color(white, a: 8)              → --tug-color(white, a: 0.08)          (alpha 0–100 → 0–1)
 *
 * The rewrite is lossless by construction: l/c are copied verbatim from the
 * resolver, and the hue name re-resolves to the identical angle, so the postcss
 * output is byte-for-byte unchanged in oklch terms.
 *
 * Usage:
 *   bun run scripts/migrate-tug-color-to-lc.ts            # dry run: stats + sample diff
 *   bun run scripts/migrate-tug-color-to-lc.ts --write    # write changes in place
 */

import fs from "fs";
import path from "path";
import {
  HUE_FAMILIES,
  TUG_COLOR_PRESETS,
  ADJACENCY_RING,
  NAMED_GRAYS,
  ACHROMATIC_SEQUENCE,
  resolveTugColorToOklch,
} from "../src/components/tugways/palette-engine";
import { parseTugColor, findTugColorCallsWithWarnings } from "../tug-color-parser";

const ROOT = path.resolve(__dirname, "..");

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
  "black",
  "white",
  "gray",
  ...Object.keys(NAMED_GRAYS),
  "transparent",
]);

const KNOWN_PRESETS = new Map(Object.entries(TUG_COLOR_PRESETS));

/** Format a number to 4 decimal places with trailing zeros stripped (matches postcss). */
function fmt(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}

/** Build the new-model inner text for one resolved call, keeping the hue name. */
function newInner(
  name: string,
  adjacentName: string | undefined,
  resolved: { L: number; C: number; alpha: number },
): string {
  const a = resolved.alpha;
  const alphaArg = a < 1 ? `, a: ${fmt(a)}` : "";
  const token = adjacentName !== undefined ? `${name}-${adjacentName}` : name;

  // transparent — no params ever.
  if (name === "transparent") return "transparent";

  // black / white — fixed endpoints, name kept, alpha honored.
  if (name === "black" || name === "white") {
    return `${name}${alphaArg}`;
  }

  // Named gray (pitch…paper) with no adjacency — fixed L, name kept, alpha honored.
  if (NAMED_GRAYS[name] !== undefined && adjacentName === undefined) {
    return `${name}${alphaArg}`;
  }

  // Any other achromatic result (gray pseudo-hue, achromatic adjacency, or a
  // black/white-anchored pair) — express the off-grid lightness via gray + l.
  if (resolved.C === 0) {
    return `gray, l: ${fmt(resolved.L)}${alphaArg}`;
  }

  // Chromatic — keep hue name / adjacency, carry explicit l + c.
  return `${token}, l: ${fmt(resolved.L)}, c: ${fmt(resolved.C)}${alphaArg}`;
}

/** Ranges of /* *\/ comments in the source, so calls inside docs are left alone. */
function commentRanges(src: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /\/\*[\s\S]*?\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

function inComment(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => pos >= s && pos < e);
}

interface Stats {
  files: number;
  calls: number;
  unchanged: number;
}

function migrateFile(rel: string, write: boolean, stats: Stats, showSample: number): number {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, "utf-8");
  const { calls } = findTugColorCallsWithWarnings(src);
  if (calls.length === 0) return 0;

  const comments = commentRanges(src);
  let result = src;
  let shown = 0;
  // Reverse order to preserve indices.
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];
    if (inComment(call.start, comments)) continue;
    const parsed = parseTugColor(
      call.inner,
      KNOWN_HUES,
      KNOWN_PRESETS,
      ADJACENCY_RING,
      ACHROMATIC_SEQUENCE,
    );
    stats.calls++;
    if (!parsed.ok) {
      throw new Error(`Parse failed in ${rel}: --tug-color(${call.inner})\n  ${parsed.errors.map((e) => e.message).join("; ")}`);
    }
    const { color, intensity, tone, alpha } = parsed.value;
    const resolved = resolveTugColorToOklch(color.name, color.adjacentName, intensity, tone, alpha);
    const inner = newInner(color.name, color.adjacentName, resolved);
    const replacement = `--tug-color(${inner})`;
    const original = result.slice(call.start, call.end);
    if (replacement === original) stats.unchanged++;
    if (shown < showSample && replacement !== original) {
      console.log(`  ${original}\n    → ${replacement}`);
      shown++;
    }
    result = result.slice(0, call.start) + replacement + result.slice(call.end);
  }

  if (write && result !== src) {
    fs.writeFileSync(abs, result, "utf-8");
  }
  stats.files++;
  return calls.length;
}

function main() {
  const write = process.argv.includes("--write");
  const stats: Stats = { files: 0, calls: 0, unchanged: 0 };
  console.log(write ? "Migrating --tug-color() → l/c (writing in place)\n" : "DRY RUN — sample rewrites per file (no files written)\n");
  for (const rel of TARGET_FILES) {
    const n = migrateFile(rel, write, stats, write ? 0 : 3);
    console.log(`${rel}: ${n} calls`);
  }
  console.log(`\n${stats.files} files, ${stats.calls} calls total, ${stats.unchanged} already in new form.`);
  if (!write) console.log("\nRe-run with --write to apply.");
}

main();
