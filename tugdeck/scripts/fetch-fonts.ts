#!/usr/bin/env bun
/**
 * fetch-fonts.ts — vendor IBM Plex woff2 faces from npm into public/fonts/.
 *
 * IBM publishes every Plex family as an OFL-1.1 npm package that already
 * ships pre-built woff2 (fonts/complete/woff2/*.woff2) — so there is no
 * conversion step. This script `npm pack`s a pinned version of each family,
 * extracts the woff2 + license, and copies them into tugdeck/public/fonts/
 * (the woff2) and tugdeck/public/fonts/licenses/ (the OFL text).
 *
 * Everything is vendored and committed; the app NEVER loads fonts from the
 * network at runtime. This script is the only thing that touches npm, and
 * only when a human runs it to add or refresh a family.
 *
 * Usage:
 *   bun run scripts/fetch-fonts.ts              # fetch every phase-1 family
 *   bun run scripts/fetch-fonts.ts plex-sans-thai   # fetch one family by short name
 *   bun run scripts/fetch-fonts.ts --list       # print the manifest and exit
 *
 * CJK families (split into ~1000 unicode-range woff2 subsets, ~80 MB each)
 * are deliberately NOT handled here yet — they need the split/ delivery
 * path, which is a separate phase.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, copyFileSync, rmSync } from "node:fs";
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
  /** phase that adopts this family (1 = non-Latin scripts). */
  phase: 1;
}

// Pinned manifest. Bump a version here, re-run, commit the new woff2.
const MANIFEST: Family[] = [
  { pkg: "plex-sans-arabic", version: "1.1.0", label: "IBM Plex Sans Arabic", phase: 1 },
  { pkg: "plex-sans-hebrew", version: "1.1.0", label: "IBM Plex Sans Hebrew", phase: 1 },
  { pkg: "plex-sans-thai", version: "1.1.0", label: "IBM Plex Sans Thai", phase: 1 },
  { pkg: "plex-sans-devanagari", version: "1.1.0", label: "IBM Plex Sans Devanagari", phase: 1 },
];

// Weight suffixes the UI requests (match the @font-face set in fonts.css).
// Script families have no italic, so only the upright faces are vendored.
const KEEP_WEIGHTS = ["Regular", "Medium", "SemiBold", "Bold"];

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_FONTS = resolve(SCRIPT_DIR, "..", "public", "fonts");
const LICENSE_DIR = join(PUBLIC_FONTS, "licenses");

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function fetchFamily(fam: Family): string[] {
  const spec = `@ibm/${fam.pkg}@${fam.version}`;
  const work = mkdtempSync(join(tmpdir(), "plex-fetch-"));
  try {
    log(`• ${fam.label} (${spec})`);
    // npm pack writes <name>-<version>.tgz into --pack-destination.
    const tgzName = execFileSync(
      "npm",
      ["pack", spec, "--pack-destination", work, "--silent"],
      { encoding: "utf8" },
    ).trim().split("\n").pop()!.trim();
    const tgz = join(work, tgzName);
    execFileSync("tar", ["-xzf", tgz, "-C", work]);

    const woffDir = join(work, "package", "fonts", "complete", "woff2");
    if (!existsSync(woffDir)) {
      throw new Error(`no complete/woff2 dir in ${spec} — packaging changed?`);
    }
    // Vendor only the weights the UI actually requests (regular/medium/
    // semibold/bold) — see fonts.css. Thin/ExtraLight/Light/Text are never
    // rendered, so shipping them would just be dead disk weight.
    const woff2 = readdirSync(woffDir)
      .filter((f) => f.endsWith(".woff2"))
      .filter((f) => KEEP_WEIGHTS.some((w) => f.endsWith(`-${w}.woff2`)));
    if (woff2.length === 0) throw new Error(`no kept-weight woff2 files in ${spec}`);

    for (const f of woff2) copyFileSync(join(woffDir, f), join(PUBLIC_FONTS, f));

    // License: complete/woff2/license.txt or the package OFL.txt.
    const licenseCandidates = [
      join(woffDir, "license.txt"),
      join(work, "package", "license.txt"),
      join(work, "package", "LICENSE.txt"),
    ];
    const lic = licenseCandidates.find(existsSync);
    if (lic) copyFileSync(lic, join(LICENSE_DIR, `${fam.pkg}-OFL.txt`));

    log(`  ↳ ${woff2.length} woff2${lic ? " + license" : ""}`);
    return woff2;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const f of MANIFEST) log(`${f.pkg}@${f.version}  (phase ${f.phase})  ${f.label}`);
    return;
  }

  const selectors = args.filter((a) => !a.startsWith("--"));
  const families = selectors.length
    ? MANIFEST.filter((f) => selectors.includes(f.pkg))
    : MANIFEST.filter((f) => f.phase === 1);

  if (families.length === 0) {
    log(`No matching families. Known: ${MANIFEST.map((f) => f.pkg).join(", ")}`);
    process.exit(1);
  }

  mkdirSync(PUBLIC_FONTS, { recursive: true });
  mkdirSync(LICENSE_DIR, { recursive: true });

  log(`Vendoring ${families.length} family(ies) → ${PUBLIC_FONTS}\n`);
  const all: string[] = [];
  for (const fam of families) all.push(...fetchFamily(fam));
  log(`\nDone. ${all.length} woff2 files vendored. Add the @font-face blocks to public/fonts.css.`);
}

main();
