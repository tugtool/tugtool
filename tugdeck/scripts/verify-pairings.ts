#!/usr/bin/env bun
/**
 * verify-pairings.ts
 *
 * Cross-check verification script for the token audit pairing convention.
 *
 * Parses every @tug-pairings block from the 23 component CSS files in
 * tugways/ and tugways/cards/, extracts the resolved --tug-* token pairs,
 * then compares against theme-pairings.ts.
 *
 * Reports:
 *   GAPS    — pairings declared in a CSS @tug-pairings block that have no
 *             corresponding entry in theme-pairings.ts.
 *             These are accessibility coverage holes — the contrast engine
 *             never checks these pairs. GAPS cause exit code 1.
 *
 *   ORPHANS — entries in theme-pairings.ts that are not
 *             traceable to any @tug-pairings block. These are informational:
 *             many legitimate map entries predate the CSS comment convention
 *             or are added from design intent rather than direct CSS observation.
 *             ORPHANS are reported but do not cause exit code 1.
 *
 * Exit codes:
 *   0 — zero gaps (orphans are printed as warnings but do not fail)
 *   1 — one or more gaps found
 *
 * Usage:
 *   bun run tugdeck/scripts/verify-pairings.ts
 *
 * References: [D02] Base-level pairings, [D03] CSS comment convention, Spec S02
 */

import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TUGDECK_ROOT = resolve(import.meta.dir, "..");
const CSS_DIRS = [
  join(TUGDECK_ROOT, "src/components/tugways"),
  join(TUGDECK_ROOT, "src/components/tugways/cards"),
];
const PAIRING_MAP_PATH = join(
  TUGDECK_ROOT,
  "src/components/tugways/theme-pairings.ts"
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CssPairing {
  element: string;
  surface: string;
  role: string;
  sourceFile: string;
  rawElement: string;
  rawSurface: string;
}

interface MapPairing {
  element: string;
  surface: string;
}

// ---------------------------------------------------------------------------
// Step 1: Collect all CSS files with @tug-pairings blocks
// ---------------------------------------------------------------------------

function collectCssFiles(): string[] {
  const files: string[] = [];
  for (const dir of CSS_DIRS) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.endsWith(".css")) {
        files.push(join(dir, entry));
      }
    }
  }
  return files.sort();
}

// ---------------------------------------------------------------------------
// Step 2: Parse @tug-pairings blocks
//
// Format (Spec S02):
//   /**
//    * @tug-pairings
//    * | Element | Surface | Role | Context |
//    * |---------|---------|------|---------|
//    * | cell    | cell    | cell | cell    |
//    */
//
// Each CSS file comment line starts with " * " (space-star-space).
// We extract the @tug-pairings block between @tug-pairings and closing "*/".
// ---------------------------------------------------------------------------

/**
 * Resolve a raw cell value from the @tug-pairings table to a --tug-* token.
 *
 * Rules:
 * 1. If the cell starts with --tug-, extract that token directly.
 *    Strip any trailing whitespace or parenthetical annotation.
 * 2. If the cell starts with --tug- (component alias), extract the resolved
 *    name from the parenthetical "(resolved-name)" and prepend --tug-.
 * 3. If the cell contains oklch(...) or is a hardcoded value, return null (skip).
 * 4. If the cell is "parent surface", "transparent", "ambient", etc., return null.
 *
 * Parenthetical may contain annotations like "(name, chromatic)" — strip the comma part.
 */
function resolveToken(raw: string): string | null {
  const trimmed = raw.trim();

  // Hardcoded oklch values or non-token entries
  if (
    trimmed.startsWith("oklch(") ||
    trimmed.startsWith("parent") ||
    trimmed.startsWith("transparent") ||
    trimmed.startsWith("ambient") ||
    trimmed === "" ||
    !trimmed.startsWith("--")
  ) {
    return null;
  }

  // Extract the base token name: everything before a space or "("
  const baseTokenMatch = trimmed.match(/^(--[\w-]+)/);
  if (!baseTokenMatch) return null;
  const tokenName = baseTokenMatch[1];

  // If it is already a --tug-* token, use it directly
  if (tokenName.startsWith("--tug-")) {
    return tokenName;
  }

  // Component alias (--tug-*): extract the resolved name from the parenthetical
  const parenMatch = trimmed.match(/\(([^)]+)\)/);
  if (!parenMatch) {
    // No parenthetical — cannot resolve; skip
    return null;
  }

  // The parenthetical may be "(resolved-name)" or "(resolved-name, chromatic)" etc.
  // Take the part before the first comma.
  const resolvedRaw = parenMatch[1].split(",")[0].trim();

  // The resolved name is a short name like "fg-default" or "tab-bg-active"
  // Prepend --tug- to get the full base token name
  if (!resolvedRaw || resolvedRaw.includes(" ")) {
    // Multi-word descriptions like "ambient" — not a token short name
    return null;
  }

  return `--tug-${resolvedRaw}`;
}

/**
 * Parse all @tug-pairings table rows from a CSS file.
 * Returns an array of resolved (element, surface) pairs.
 * Skips decorative pairs and pairs with non-token surfaces (ambient, parent, hardcoded).
 * Skips header rows and separator rows.
 */
function parsePairingsFromFile(filePath: string): CssPairing[] {
  const content = readFileSync(filePath, "utf-8");
  const pairings: CssPairing[] = [];

  // Find the @tug-pairings block
  const blockStart = content.indexOf("@tug-pairings");
  if (blockStart === -1) return pairings;

  // Extract lines from blockStart to the closing "*/"
  const blockEnd = content.indexOf("*/", blockStart);
  if (blockEnd === -1) return pairings;

  const block = content.slice(blockStart, blockEnd);
  const lines = block.split("\n");

  for (const line of lines) {
    // Strip leading " * " comment prefix
    const stripped = line.replace(/^\s*\*\s?/, "").trim();

    // Only process table data rows (start and end with |)
    if (!stripped.startsWith("|") || !stripped.endsWith("|")) continue;

    // Split by | and extract cells
    const cells = stripped
      .split("|")
      .map((c) => c.trim())
      .filter((_, i, arr) => i > 0 && i < arr.length - 1); // drop empty first/last

    if (cells.length < 3) continue;

    const rawElement = cells[0].trim();
    const rawSurface = cells[1].trim();
    const role = cells[2].trim();

    // Skip header row (contains "Element" as the first cell)
    if (rawElement === "Element" || rawElement.startsWith("---")) continue;

    // Skip separator rows (all dashes)
    if (rawElement.replace(/-/g, "").trim() === "") continue;

    // Skip decorative pairings — they have no minimum contrast requirement
    // and are not present in the pairing map
    if (role === "decorative") continue;

    // Skip rows with no concrete token (free-text descriptions)
    const element = resolveToken(rawElement);
    const surface = resolveToken(rawSurface);

    if (!element || !surface) continue;

    pairings.push({
      element,
      surface,
      role,
      sourceFile: filePath.replace(TUGDECK_ROOT + "/", ""),
      rawElement,
      rawSurface,
    });
  }

  return pairings;
}

// ---------------------------------------------------------------------------
// Step 3: Load the pairing map from theme-pairings.ts
//
// The file is TypeScript, not JSON, so we parse it with regex rather than
// importing it (which would require a full TS execution context with all
// transitive deps).
// ---------------------------------------------------------------------------

function loadPairingMap(): MapPairing[] {
  const content = readFileSync(PAIRING_MAP_PATH, "utf-8");
  const pairings: MapPairing[] = [];

  // Match { element: "...", surface: "...", ... } object literals
  // The regex handles multi-line objects. We look for element/surface properties.
  const objectPattern =
    /\{\s*(?:\/\/[^\n]*\n\s*)*element:\s*"(--[\w-]+)"[^}]*?surface:\s*"(--[\w-]+)"/gs;

  let match: RegExpExecArray | null;
  while ((match = objectPattern.exec(content)) !== null) {
    pairings.push({
      element: match[1],
      surface: match[2],
    });
  }

  return pairings;
}

// ---------------------------------------------------------------------------
// Step 4: Cross-check
// ---------------------------------------------------------------------------

function pairingKey(element: string, surface: string): string {
  return `${element}|${surface}`;
}

function runCrossCheck(): void {
  console.log("verify-pairings: cross-checking @tug-pairings CSS blocks against theme-pairings.ts\n");

  // Collect CSS files
  const cssFiles = collectCssFiles();
  console.log(`  CSS files scanned: ${cssFiles.length}`);

  // Parse all CSS pairings
  const cssPairings: CssPairing[] = [];
  for (const file of cssFiles) {
    const filePairings = parsePairingsFromFile(file);
    cssPairings.push(...filePairings);
  }

  // Deduplicate CSS pairings by (element, surface) key
  const cssKeySet = new Map<string, CssPairing>();
  for (const p of cssPairings) {
    const key = pairingKey(p.element, p.surface);
    if (!cssKeySet.has(key)) {
      cssKeySet.set(key, p);
    }
  }

  console.log(`  CSS pairings parsed (after dedup): ${cssKeySet.size}`);

  // Load map
  const mapPairings = loadPairingMap();
  const mapKeySet = new Set<string>();
  for (const p of mapPairings) {
    mapKeySet.add(pairingKey(p.element, p.surface));
  }

  console.log(`  Map entries loaded: ${mapPairings.length}\n`);

  // Find GAPS: CSS pairs not in map
  const gaps: CssPairing[] = [];
  for (const [key, pairing] of cssKeySet) {
    if (!mapKeySet.has(key)) {
      gaps.push(pairing);
    }
  }

  // Find ORPHANS: map pairs not in any CSS block
  const orphans: MapPairing[] = [];
  for (const p of mapPairings) {
    const key = pairingKey(p.element, p.surface);
    if (!cssKeySet.has(key)) {
      orphans.push(p);
    }
  }

  // Report GAPS
  if (gaps.length === 0) {
    console.log("  GAPS: none — all CSS-declared pairings are covered by the map.");
  } else {
    console.log(`  GAPS (${gaps.length}) — CSS pairings NOT in theme-pairings.ts:`);
    for (const g of gaps) {
      console.log(`    [GAP] ${g.element} | ${g.surface} (${g.role}) — ${g.sourceFile}`);
    }
  }

  console.log();

  // Report ORPHANS (informational only)
  if (orphans.length === 0) {
    console.log("  ORPHANS: none — all map entries trace to a CSS @tug-pairings block.");
  } else {
    console.log(
      `  ORPHANS (${orphans.length}) — map entries not traceable to any @tug-pairings block (informational):`
    );
    for (const o of orphans) {
      console.log(`    [ORPHAN] ${o.element} | ${o.surface}`);
    }
  }

  console.log();

  // Summary
  if (gaps.length === 0 && orphans.length === 0) {
    console.log("  Result: PASS — zero gaps, zero orphans.");
    process.exit(0);
  } else if (gaps.length === 0) {
    console.log(
      `  Result: PASS (with ${orphans.length} informational orphan(s)) — zero gaps; orphans are pre-existing map entries added from design intent.`
    );
    process.exit(0);
  } else {
    console.log(
      `  Result: FAIL — ${gaps.length} gap(s) found. Add the missing pairings to theme-pairings.ts.`
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

runCrossCheck();
