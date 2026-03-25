#!/usr/bin/env bun
/**
 * generate-rename-maps.ts — Generate JSON rename maps for the four-prefix migration.
 *
 * Scans all CSS files under tugdeck/styles/ (including themes/) and component
 * CSS files under tugdeck/src/components/ for `--tug-*` property declarations.
 * Deduplicates by token name, classifies each via token-classify.ts, and
 * writes three JSON map files:
 *
 *   tugdeck/rename-tug7.json   — seven-slot semantic tokens
 *   tugdeck/rename-tugc.json   — palette color tokens
 *   tugdeck/rename-tugx.json   — extension/component-alias tokens
 *
 * Tokens that classify as "tug" (scale/dimension) are skipped (no rename).
 *
 * Usage:
 *   bun run scripts/generate-rename-maps.ts
 *   bun run generate:rename-maps
 */

import fs from "fs";
import path from "path";
import { classifyTokenShortName } from "./token-classify";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const TUGDECK = path.resolve(import.meta.dir, "..");
const STYLES_DIR = path.join(TUGDECK, "styles");
const COMPONENTS_DIR = path.join(TUGDECK, "src/components");

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .css files under a directory.
 */
function collectCssFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...collectCssFiles(full));
    } else if (stat.isFile() && entry.endsWith(".css")) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

/**
 * Extract all `--tug-*` short names (the part after `--tug-`) from a CSS
 * file. Only matches declaration lines (lines with a colon after the property
 * name), not var() references.
 *
 * Returns a Set of short names found in the file.
 */
function extractTugTokenShortNames(cssContent: string): Set<string> {
  const found = new Set<string>();
  // Match property declarations: --tug-{name}: ...
  // Anchored to start of token (preceded by newline, whitespace, or start)
  const re = /(?:^|[\s;{])--tug-([\w-]+)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssContent)) !== null) {
    found.add(m[1]);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // Collect all CSS files to scan
  const stylesCssFiles = collectCssFiles(STYLES_DIR);
  const componentsCssFiles = collectCssFiles(COMPONENTS_DIR);
  const allCssFiles = [...stylesCssFiles, ...componentsCssFiles];

  // Deduplicated set of all --tug-* short names
  const allShortNames = new Set<string>();

  for (const filePath of allCssFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    for (const shortName of extractTugTokenShortNames(content)) {
      allShortNames.add(shortName);
    }
  }

  console.log(`\nScanned ${allCssFiles.length} CSS files`);
  console.log(`Found ${allShortNames.size} unique --tug-* token short names\n`);

  // Classify and route to maps
  const tug7Map: Record<string, string> = {};
  const tugcMap: Record<string, string> = {};
  const tugxMap: Record<string, string> = {};

  let tug7Count = 0;
  let tugcCount = 0;
  let tugxCount = 0;
  let tugCount = 0;
  const unclassified: string[] = [];

  for (const shortName of allShortNames) {
    const category = classifyTokenShortName(shortName);

    switch (category) {
      case "tug7":
        tug7Map[`--tug-${shortName}`] = `--tug7-${shortName}`;
        tug7Count++;
        break;
      case "tugc":
        tugcMap[`--tug-${shortName}`] = `--tugc-${shortName}`;
        tugcCount++;
        break;
      case "tugx":
        tugxMap[`--tug-${shortName}`] = `--tugx-${shortName}`;
        tugxCount++;
        break;
      case "tug":
        // Scale tokens: no rename
        tugCount++;
        break;
      default:
        unclassified.push(shortName);
        break;
    }
  }

  // Sort maps alphabetically by key
  function sortedMap(m: Record<string, string>): Record<string, string> {
    const sorted: Record<string, string> = {};
    for (const key of Object.keys(m).sort()) {
      sorted[key] = m[key];
    }
    return sorted;
  }

  const tug7Sorted = sortedMap(tug7Map);
  const tugcSorted = sortedMap(tugcMap);
  const tugxSorted = sortedMap(tugxMap);

  // Write JSON files
  const tug7Path = path.join(TUGDECK, "rename-tug7.json");
  const tugcPath = path.join(TUGDECK, "rename-tugc.json");
  const tugxPath = path.join(TUGDECK, "rename-tugx.json");

  fs.writeFileSync(tug7Path, JSON.stringify(tug7Sorted, null, 2) + "\n", "utf-8");
  fs.writeFileSync(tugcPath, JSON.stringify(tugcSorted, null, 2) + "\n", "utf-8");
  fs.writeFileSync(tugxPath, JSON.stringify(tugxSorted, null, 2) + "\n", "utf-8");

  // Summary
  console.log("=== Rename Map Summary ===\n");
  console.log(`  tug7 (seven-slot):    ${tug7Count.toString().padStart(4)} tokens  →  rename-tug7.json`);
  console.log(`  tugc (palette):       ${tugcCount.toString().padStart(4)} tokens  →  rename-tugc.json`);
  console.log(`  tugx (extension):     ${tugxCount.toString().padStart(4)} tokens  →  rename-tugx.json`);
  console.log(`  tug  (scale/dim):     ${tugCount.toString().padStart(4)} tokens  →  (no rename)`);
  console.log(`  Total:                ${(tug7Count + tugcCount + tugxCount + tugCount).toString().padStart(4)} tokens\n`);

  if (unclassified.length > 0) {
    console.log(`WARNING: ${unclassified.length} unclassified tokens (treated as 'tug', no rename):`);
    for (const name of unclassified.sort()) {
      console.log(`  --tug-${name}`);
    }
    console.log();
  }

  // Verify no token appears in more than one map
  const allMapKeys = [
    ...Object.keys(tug7Sorted),
    ...Object.keys(tugcSorted),
    ...Object.keys(tugxSorted),
  ];
  const keySet = new Set<string>();
  const duplicates: string[] = [];
  for (const key of allMapKeys) {
    if (keySet.has(key)) {
      duplicates.push(key);
    }
    keySet.add(key);
  }

  if (duplicates.length > 0) {
    console.error(`ERROR: ${duplicates.length} token(s) appear in multiple maps:`);
    for (const d of duplicates) {
      console.error(`  ${d}`);
    }
    process.exit(1);
  }

  console.log("✓ No duplicates across maps.");
  console.log(`✓ Wrote ${tug7Path}`);
  console.log(`✓ Wrote ${tugcPath}`);
  console.log(`✓ Wrote ${tugxPath}`);
}

main();
