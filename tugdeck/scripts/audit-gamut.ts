/**
 * audit-gamut — flag --tug-color() recipes that resolve outside the display gamut.
 *
 * In the OKLCH model, `--tug-color(hue, l, c)` carries chroma verbatim, so an author
 * can request more saturation than a hue can show. The browser gamut-maps such colors
 * (holding hue + lightness, reducing chroma), so this is a *truth-in-authoring* check,
 * not a render-correctness one — but a chroma far past Display P3 means the authored
 * number bears no relation to the pixel.
 *
 * Two tiers, mirroring tug's two color spaces:
 *   - **out-of-sRGB** — richer than sRGB; renders as authored on P3, maps down on sRGB.
 *     This is *intended* for signal colors (they deliberately push ~2× the sRGB cap),
 *     so it is reported as informational only.
 *   - **out-of-P3** — beyond what any display can show; the gamut map always clamps it.
 *
 * This is **advisory**, not a gate. Out-of-P3 is pervasive *by design* — signals are
 * pushed past sRGB so P3 renders them richer, and light themes legitimately push
 * further than dark ones (more saturation to hold contrast on near-white; see
 * theme-engine.md). So a hard count gate would flag accepted design. The audit's job
 * is visibility: when you author or tune a color, see which recipes leave the gamut
 * and by how much. Pass `--strict` to turn any out-of-P3 into a nonzero exit (CI hook
 * for a team that wants to freeze the current footprint).
 *
 * Usage:
 *   bun run scripts/audit-gamut.ts            # all themes + shared CSS — per-theme summary
 *   bun run scripts/audit-gamut.ts <theme>    # one theme, full out-of-P3 drill-down
 *   bun run scripts/audit-gamut.ts --strict   # exit nonzero if any token is out-of-P3
 */

import fs from "fs";
import path from "path";
import {
  HUE_FAMILIES,
  NAMED_GRAYS,
  ADJACENCY_RING,
  AUTHOR_MAX,
  MAX_CHROMA,
  authoredFromChroma,
  resolveTugColorToOklch,
  isInSRGBGamut,
  isInP3Gamut,
  maxChromaInGamut,
} from "../src/components/tugways/palette-engine";
import { parseTugColor, findTugColorCallsWithWarnings } from "../tug-color-parser";

const TUGDECK = path.resolve(import.meta.dir, "..");
const THEMES_DIR = path.join(TUGDECK, "styles", "themes");

const KNOWN_HUES: ReadonlySet<string> = new Set([
  ...Object.keys(HUE_FAMILIES),
  "black", "white", "gray", "transparent",
  ...NAMED_GRAYS,
]);

interface Finding {
  line: number;
  recipe: string;
  C: number;
  /** Max chroma that would fit in P3 at this color's L + hue. */
  maxP3C: number;
}

interface FileReport {
  label: string;
  total: number;
  outSRGB: number;
  outP3: Finding[];
}

/** 1-based line number for a character offset. */
function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

function auditFile(absPath: string, label: string): FileReport {
  const src = fs.readFileSync(absPath, "utf-8");
  const { calls } = findTugColorCallsWithWarnings(src);
  const report: FileReport = { label, total: 0, outSRGB: 0, outP3: [] };
  for (const call of calls) {
    const parsed = parseTugColor(call.inner, KNOWN_HUES, ADJACENCY_RING);
    if (!parsed.ok) continue;
    const { color, lightness, chroma, alpha } = parsed.value;
    const { L, C, h } = resolveTugColorToOklch(color.name, color.adjacentName, lightness, chroma, alpha);
    if (C <= 0) continue; // achromatic — always in gamut
    report.total++;
    if (!isInSRGBGamut(L, C, h)) report.outSRGB++;
    if (!isInP3Gamut(L, C, h)) {
      report.outP3.push({
        line: lineAt(src, call.start),
        recipe: `--tug-color(${call.inner})`,
        C,
        maxP3C: maxChromaInGamut(L, h, isInP3Gamut),
      });
    }
  }
  return report;
}

/** Discover the theme files; one report per theme. */
function themeReports(only?: string): FileReport[] {
  const files = fs.readdirSync(THEMES_DIR)
    .filter((f) => f.endsWith(".css"))
    .filter((f) => only === undefined || f === `${only}.css`)
    .sort();
  return files.map((f) => auditFile(path.join(THEMES_DIR, f), f.replace(/\.css$/, "")));
}

/** Shared, theme-invariant CSS that also carries --tug-color() recipes. */
function sharedReports(): FileReport[] {
  const shared = [
    "styles/tug.css",
    "src/components/tugways/tug-code.css",
    "src/components/tugways/tug-data.css",
    "src/components/tugways/tug-dialog.css",
    "src/components/tugways/tug-dock.css",
  ];
  return shared
    .map((rel) => ({ rel, abs: path.join(TUGDECK, rel) }))
    .filter(({ abs }) => fs.existsSync(abs))
    .map(({ rel, abs }) => auditFile(abs, rel));
}

/** Summary line: in-sRGB / out-of-sRGB (intended for signals) / out-of-P3. */
function printSummary(r: FileReport): void {
  const mark = r.outP3.length === 0 ? "✓" : "•";
  console.log(`${mark} ${r.label}: ${r.total} chromatic · ${r.outSRGB} out-of-sRGB · ${r.outP3.length} out-of-P3`);
}

/** Full per-recipe drill-down (single-theme mode). Chroma shown in authored 0–1000 units. */
function printDetail(r: FileReport): void {
  for (const f of r.outP3) {
    console.log(`    ${r.label}:${f.line}  ${f.recipe}`);
    console.log(`      chroma ${authoredFromChroma(f.C)} exceeds P3 max ${Math.floor((f.maxP3C / MAX_CHROMA) * AUTHOR_MAX)} at this lightness`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const only = args.find((a) => !a.startsWith("--"));

  const themes = themeReports(only);
  if (themes.length === 0) {
    console.error(`No theme '${only}' found in ${path.relative(TUGDECK, THEMES_DIR)}.`);
    process.exit(1);
  }

  console.log("=== Gamut Audit — out-of-P3 --tug-color() recipes ===\n");
  for (const r of themes) printSummary(r);

  // Single-theme run: drill down into that theme's out-of-P3 recipes.
  if (only) {
    console.log("");
    for (const r of themes) printDetail(r);
    return;
  }

  const shared = sharedReports();
  if (shared.length) {
    console.log("\n--- shared / component CSS (theme-invariant) ---");
    for (const r of shared) printSummary(r);
  }

  const totalOutP3 = [...themes, ...shared].reduce((n, r) => n + r.outP3.length, 0);
  console.log(
    `\nout-of-sRGB is expected: signals are authored past sRGB by design so P3 displays` +
    ` render them richer (light themes push further than dark). out-of-P3 is the tier` +
    ` that matters — it should stay 0 (authored chroma = what a P3 display delivers).` +
    ` Run \`audit-gamut <theme>\` to drill in, \`clamp-theme-gamut --write\` to fix.`,
  );

  if (strict && totalOutP3 > 0) {
    console.log(`\n✗ --strict: ${totalOutP3} out-of-P3 token(s) across themes + shared CSS.`);
    process.exit(1);
  }
}

main();
