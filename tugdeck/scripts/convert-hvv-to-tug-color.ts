/**
 * convert-hvv-to-tug-color — Batch conversion script for --hvv() → --tug-color() in CSS files.
 *
 * Reads a CSS file, finds all --hvv(hue, vib, val[, alpha]) calls using regex,
 * converts them to --tug-color(hue, i: vib, t: val[, a: alpha*100]) format,
 * and writes the file back.
 *
 * Conversion rules:
 *   - Named hues (e.g., `blue`, `cobalt`): used as-is
 *   - `hue-NNN` format: find nearest named hue + smallest degree offset
 *   - Raw numeric angles: same nearest-hue logic
 *   - Alpha: old alpha was 0-1, new alpha is 0-100. Multiply by 100. Omit `a:` if 100.
 *   - Simplification: if intensity==50 && tone==50 && no alpha ) → --tug-color(color)
 *   - Simplification: if tone==50 && no alpha ) → --tug-color(color, i: N)
 *
 * Nearest-hue algorithm: for a raw angle, find the named hue with minimum
 * circular angular distance. Use that hue name + (angle - hue_angle) as offset.
 * Always minimize absolute offset (prefer e.g. violet-6 over cobalt+14).
 *
 * Usage (run from tugdeck directory):
 *   bun run scripts/convert-hvv-to-tug-color.ts <css-file> [<css-file> ...]
 *
 * @module scripts/convert-hvv-to-tug-color
 */

import { readFileSync, writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// HUE_FAMILIES — copy of palette-engine.ts data to avoid circular imports
// ---------------------------------------------------------------------------

const HUE_FAMILIES: Record<string, number> = {
  cherry:  10,
  red:     25,
  tomato:  35,
  flame:   45,
  orange:  55,
  amber:   65,
  gold:    75,
  yellow:  90,
  lime:   115,
  green:  140,
  mint:   155,
  teal:   175,
  cyan:   200,
  sky:    215,
  blue:   230,
  cobalt: 250,
  violet: 270,
  purple: 285,
  plum:   300,
  pink:   320,
  rose:   335,
  magenta:345,
  berry:  355,
  coral:   20,
};

// ---------------------------------------------------------------------------
// Nearest-hue resolution
// ---------------------------------------------------------------------------

/**
 * Find the named hue with the minimum circular angular distance to `angle`.
 * Returns { name, offset } where offset = angle - hue_angle (signed).
 * If there's a tie, prefer the hue with the smaller index (insertion order).
 */
function findNearestHue(angle: number): { name: string; offset: number } {
  let bestName = "";
  let bestOffset = 0;
  let bestDist = Infinity;

  for (const [name, hueAngle] of Object.entries(HUE_FAMILIES)) {
    // Compute the signed offset that minimizes absolute circular distance
    let offset = angle - hueAngle;
    // Normalize to [-180, 180]
    while (offset > 180) offset -= 360;
    while (offset < -180) offset += 360;
    const dist = Math.abs(offset);
    if (dist < bestDist) {
      bestDist = dist;
      bestName = name;
      bestOffset = offset;
    }
  }

  return { name: bestName, offset: Math.round(bestOffset) };
}

// ---------------------------------------------------------------------------
// Old --hvv() regex
// ---------------------------------------------------------------------------

/**
 * Matches a single --hvv() call.
 * Group 1: hue (named, hue-NNN, or raw number)
 * Group 2: vibrancy (0-100)
 * Group 3: value (0-100)
 * Group 4: alpha (0-1, optional)
 */
const HVV_PATTERN = /--hvv\(\s*(hue-\d+|[a-z]+|\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d*\.?\d+)\s*)?\)/g;

// ---------------------------------------------------------------------------
// Single call conversion
// ---------------------------------------------------------------------------

/**
 * Convert one --hvv(...) match to --tug-color(...) format.
 */
function convertHvvMatch(
  hueArg: string,
  vibStr: string,
  valStr: string,
  alphaStr: string | undefined,
): string {
  const vib = parseFloat(vibStr);
  const val = parseFloat(valStr);

  // Compute alpha in 0-100 range. Old alpha was 0-1.
  let alpha: number | undefined;
  if (alphaStr !== undefined) {
    const oldAlpha = parseFloat(alphaStr);
    const newAlpha = Math.round(oldAlpha * 100);
    alpha = newAlpha < 100 ? newAlpha : undefined; // omit if 100
  }

  // Resolve hue to named hue + offset
  let colorSpec: string;
  if (HUE_FAMILIES[hueArg] !== undefined) {
    // Already a named hue
    colorSpec = hueArg;
  } else if (hueArg.startsWith("hue-")) {
    // hue-NNN form
    const angle = parseFloat(hueArg.slice(4));
    const { name, offset } = findNearestHue(angle);
    if (offset === 0) {
      colorSpec = name;
    } else if (offset > 0) {
      colorSpec = `${name}+${offset}`;
    } else {
      colorSpec = `${name}${offset}`; // negative offset: name-N
    }
  } else {
    // Raw numeric angle
    const angle = parseFloat(hueArg);
    const { name, offset } = findNearestHue(angle);
    if (offset === 0) {
      colorSpec = name;
    } else if (offset > 0) {
      colorSpec = `${name}+${offset}`;
    } else {
      colorSpec = `${name}${offset}`; // negative offset: name-N
    }
  }

  // Simplification rules
  if (alpha === undefined && vib === 50 && val === 50) {
    // Simplest form: just the color
    return `--tug-color(${colorSpec})`;
  }
  if (alpha === undefined && val === 50) {
    // Omit tone
    return `--tug-color(${colorSpec}, i: ${vib})`;
  }

  // Full labeled form
  const parts: string[] = [colorSpec, `i: ${vib}`, `t: ${val}`];
  if (alpha !== undefined) {
    parts.push(`a: ${alpha}`);
  }
  return `--tug-color(${parts.join(", ")})`;
}

// ---------------------------------------------------------------------------
// CSS file conversion
// ---------------------------------------------------------------------------

/**
 * Convert all --hvv() calls in a CSS string to --tug-color() format.
 * Returns { converted, count }.
 */
export function convertCSSContent(content: string): { converted: string; count: number } {
  let count = 0;
  HVV_PATTERN.lastIndex = 0;

  const converted = content.replace(
    HVV_PATTERN,
    (_match, hue, vib, val, alpha) => {
      count++;
      return convertHvvMatch(
        hue as string,
        vib as string,
        val as string,
        alpha as string | undefined,
      );
    },
  );

  return { converted, count };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: bun run scripts/convert-hvv-to-tug-color.ts <css-file> [<css-file> ...]");
    process.exit(1);
  }

  let totalConverted = 0;

  for (const filePath of args) {
    console.log(`Converting ${filePath}...`);
    const original = readFileSync(filePath, "utf8");
    const { converted, count } = convertCSSContent(original);

    if (count === 0) {
      console.log(`  No --hvv() calls found in ${filePath}.`);
      continue;
    }

    writeFileSync(filePath, converted, "utf8");
    console.log(`  Converted ${count} --hvv() calls to --tug-color().`);
    totalConverted += count;

    // Verify no --hvv( remains
    const remaining = (converted.match(/--hvv\(/g) ?? []).length;
    if (remaining > 0) {
      console.error(`  WARNING: ${remaining} --hvv() calls remain unconverted!`);
    }
  }

  console.log(`\nTotal: ${totalConverted} --hvv() calls converted.`);
}
