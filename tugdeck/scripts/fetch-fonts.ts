#!/usr/bin/env bun
/**
 * fetch-fonts.ts — vendor IBM Plex woff2 faces from npm into public/fonts/.
 *
 * IBM publishes every Plex family as an OFL-1.1 npm package that already
 * ships pre-built woff2 — so there is no conversion step. This script
 * `npm pack`s a pinned version of each family, extracts the woff2 + license,
 * and vendors them under tugdeck/public/fonts/. Everything is committed; the
 * app NEVER loads fonts from the network at runtime. This script is the only
 * thing that touches npm, and only when a human runs it.
 *
 * Two delivery shapes:
 *
 *  - Alphabetic families (Latin scripts: Arabic/Hebrew/Thai/Devanagari) ship
 *    one woff2 per weight in fonts/complete/woff2/. Those land flat in
 *    public/fonts/ and are declared by hand in public/fonts.css.
 *
 *  - CJK families (JP/KR/SC/TC) are enormous, so IBM pre-splits each weight
 *    into ~100-200 unicode-range subset woff2 (fonts/split/woff2/hinted/) with
 *    a generated per-weight CSS that carries the `unicode-range` @font-face
 *    rules. The browser then downloads only the subsets whose codepoints are
 *    actually on screen. We vendor those into public/fonts/cjk/<pkg>/ (CSS
 *    beside its woff2 so the relative url()s resolve) and regenerate
 *    public/fonts-cjk.css, a flat list of @imports that index.html links.
 *
 * Usage:
 *   bun run scripts/fetch-fonts.ts                 # all alphabetic (phase 1)
 *   bun run scripts/fetch-fonts.ts plex-sans-kr    # one family by short name
 *   bun run scripts/fetch-fonts.ts --cjk           # all CJK families
 *   bun run scripts/fetch-fonts.ts --list          # print the manifest
 */

import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, copyFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface Family {
  /** short name == npm package without the @ibm/ scope; CLI selector. */
  pkg: string;
  /** pinned version to vendor (reproducible output). */
  version: string;
  /** human label for logging. */
  label: string;
  /** font-file stem, e.g. "IBMPlexSansKR" (matches the woff2/CSS basenames). */
  stem: string;
  /** phase that adopts this family (1 = Latin scripts, 4 = CJK). */
  phase: 1 | 4;
  /** CJK families ship pre-split unicode-range subsets, not flat woff2. */
  split?: boolean;
}

// Pinned manifest. Bump a version here, re-run, commit the new woff2.
const MANIFEST: Family[] = [
  { pkg: "plex-sans-arabic", version: "1.1.0", label: "IBM Plex Sans Arabic", stem: "IBMPlexSansArabic", phase: 1 },
  { pkg: "plex-sans-hebrew", version: "1.1.0", label: "IBM Plex Sans Hebrew", stem: "IBMPlexSansHebrew", phase: 1 },
  { pkg: "plex-sans-thai", version: "1.1.0", label: "IBM Plex Sans Thai", stem: "IBMPlexSansThai", phase: 1 },
  { pkg: "plex-sans-devanagari", version: "1.1.0", label: "IBM Plex Sans Devanagari", stem: "IBMPlexSansDevanagari", phase: 1 },
  { pkg: "plex-sans-jp", version: "3.0.0", label: "IBM Plex Sans JP", stem: "IBMPlexSansJP", phase: 4, split: true },
  { pkg: "plex-sans-kr", version: "1.1.0", label: "IBM Plex Sans KR", stem: "IBMPlexSansKR", phase: 4, split: true },
  { pkg: "plex-sans-sc", version: "1.1.0", label: "IBM Plex Sans SC", stem: "IBMPlexSansSC", phase: 4, split: true },
  { pkg: "plex-sans-tc", version: "1.1.1", label: "IBM Plex Sans TC", stem: "IBMPlexSansTC", phase: 4, split: true },
];

// Weights the UI requests (match the @font-face set in fonts.css). Both the
// flat alphabetic families and the split CJK families ship the same four;
// Thin/ExtraLight/Light/Text are never rendered, so they are skipped.
const KEEP_WEIGHTS = ["Regular", "Medium", "SemiBold", "Bold"];
const CJK_KEEP_WEIGHTS = KEEP_WEIGHTS;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(SCRIPT_DIR, "..", "public");
const PUBLIC_FONTS = join(PUBLIC, "fonts");
const LICENSE_DIR = join(PUBLIC_FONTS, "licenses");
const CJK_DIR = join(PUBLIC_FONTS, "cjk");
const CJK_INDEX_CSS = join(PUBLIC, "fonts-cjk.css");

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/** npm pack + extract a pinned spec into a fresh temp dir; returns its root. */
function unpack(fam: Family, work: string): string {
  const spec = `@ibm/${fam.pkg}@${fam.version}`;
  const tgzName = execFileSync("npm", ["pack", spec, "--pack-destination", work, "--silent"], {
    encoding: "utf8",
  }).trim().split("\n").pop()!.trim();
  execFileSync("tar", ["-xzf", join(work, tgzName), "-C", work]);
  return join(work, "package");
}

function copyLicense(pkgRoot: string, fam: Family, ...extraDirs: string[]): boolean {
  const candidates = [
    ...extraDirs.map((d) => join(d, "license.txt")),
    join(pkgRoot, "license.txt"),
    join(pkgRoot, "LICENSE.txt"),
  ];
  const lic = candidates.find(existsSync);
  if (lic) copyFileSync(lic, join(LICENSE_DIR, `${fam.pkg}-OFL.txt`));
  return lic !== undefined;
}

/** Flat per-weight woff2 (alphabetic families) → public/fonts/. */
function fetchFlat(fam: Family, pkgRoot: string): number {
  const woffDir = join(pkgRoot, "fonts", "complete", "woff2");
  if (!existsSync(woffDir)) throw new Error(`no complete/woff2 in ${fam.pkg} — packaging changed?`);
  const woff2 = readdirSync(woffDir)
    .filter((f) => f.endsWith(".woff2"))
    .filter((f) => KEEP_WEIGHTS.some((w) => f.endsWith(`-${w}.woff2`)));
  if (woff2.length === 0) throw new Error(`no kept-weight woff2 in ${fam.pkg}`);
  for (const f of woff2) copyFileSync(join(woffDir, f), join(PUBLIC_FONTS, f));
  const lic = copyLicense(pkgRoot, fam, woffDir);
  log(`  ↳ ${woff2.length} woff2${lic ? " + license" : ""}`);
  return woff2.length;
}

/** Pre-split unicode-range subsets + per-weight CSS (CJK) → public/fonts/cjk/<pkg>/. */
function fetchSplit(fam: Family, pkgRoot: string): number {
  const splitDir = join(pkgRoot, "fonts", "split", "woff2", "hinted");
  if (!existsSync(splitDir)) throw new Error(`no split/woff2/hinted in ${fam.pkg} — packaging changed?`);
  const dest = join(CJK_DIR, fam.pkg);
  mkdirSync(dest, { recursive: true });
  const all = readdirSync(splitDir);
  let count = 0;
  for (const w of CJK_KEEP_WEIGHTS) {
    // The generated CSS for this weight + every subset woff2 it references.
    const css = `${fam.stem}-${w}.css`;
    if (all.includes(css)) { copyFileSync(join(splitDir, css), join(dest, css)); count++; }
    for (const f of all) {
      if (f.startsWith(`${fam.stem}-${w}-`) && f.endsWith(".woff2")) {
        copyFileSync(join(splitDir, f), join(dest, f)); count++;
      }
    }
  }
  if (count === 0) throw new Error(`no kept-weight split files in ${fam.pkg}`);
  const lic = copyLicense(pkgRoot, fam, splitDir);
  log(`  ↳ ${count} split files (${CJK_KEEP_WEIGHTS.join("/")})${lic ? " + license" : ""}`);
  return count;
}

function fetchFamily(fam: Family): number {
  const work = mkdtempSync(join(tmpdir(), "plex-fetch-"));
  try {
    log(`• ${fam.label} (@ibm/${fam.pkg}@${fam.version})`);
    const pkgRoot = unpack(fam, work);
    return fam.split ? fetchSplit(fam, pkgRoot) : fetchFlat(fam, pkgRoot);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Rebuild public/fonts-cjk.css from whatever CJK weight-CSS is on disk, so the
 *  @import list always matches the vendored subsets (partial runs accumulate). */
function regenCjkIndex(): void {
  if (!existsSync(CJK_DIR)) return;
  const imports: string[] = [];
  for (const pkg of readdirSync(CJK_DIR).sort()) {
    const dir = join(CJK_DIR, pkg);
    for (const css of readdirSync(dir).filter((f) => f.endsWith(".css")).sort()) {
      imports.push(`@import url("/fonts/cjk/${pkg}/${css}");`);
    }
  }
  const header =
    "/* fonts-cjk.css — GENERATED by scripts/fetch-fonts.ts; do not hand-edit.\n" +
    "   One @import per vendored CJK weight. Each imported sheet carries the\n" +
    "   unicode-range @font-face rules; the browser fetches only the subsets it\n" +
    "   needs. Linked from index.html after fonts.css. */\n\n";
  writeFileSync(CJK_INDEX_CSS, header + imports.join("\n") + "\n");
  log(`\nRegenerated fonts-cjk.css (${imports.length} @import).`);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const f of MANIFEST) log(`${f.pkg}@${f.version}  (phase ${f.phase}${f.split ? ", split" : ""})  ${f.label}`);
    return;
  }

  const selectors = args.filter((a) => !a.startsWith("--"));
  let families: Family[];
  if (selectors.length) families = MANIFEST.filter((f) => selectors.includes(f.pkg));
  else if (args.includes("--cjk")) families = MANIFEST.filter((f) => f.phase === 4);
  else families = MANIFEST.filter((f) => f.phase === 1);

  if (families.length === 0) {
    log(`No matching families. Known: ${MANIFEST.map((f) => f.pkg).join(", ")}`);
    process.exit(1);
  }

  mkdirSync(PUBLIC_FONTS, { recursive: true });
  mkdirSync(LICENSE_DIR, { recursive: true });

  log(`Vendoring ${families.length} family(ies) → ${PUBLIC_FONTS}\n`);
  let total = 0;
  for (const fam of families) total += fetchFamily(fam);
  if (families.some((f) => f.split)) regenCjkIndex();
  log(`\nDone. ${total} files vendored.`);
}

main();
