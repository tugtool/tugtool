#!/usr/bin/env bun
/**
 * generate-tug-control-tokens.ts
 *
 * Generates the emphasis × role control token section of styles/tug-base.css
 * from the derivation engine. The engine (deriveTheme) is the single source
 * of truth; this script keeps tug-base.css in sync.
 *
 * The generated block is delimited by marker comments in tug-base.css:
 *   /* @generated:control-tokens:begin ...
 *   /* @generated:control-tokens:end ...
 *
 * Everything between those markers (inclusive of begin, exclusive of end)
 * is replaced by this script's output.
 *
 * Usage:
 *   bun run scripts/generate-tug-control-tokens.ts
 *
 * Or via package.json:
 *   bun run generate:control-tokens
 */

import path from "path";
import {
  deriveTheme,
  EXAMPLE_RECIPES,
} from "../src/components/tugways/theme-derivation-engine";

// ---------------------------------------------------------------------------
// Generate tokens from the Brio (default) recipe
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sort: group by emphasis-role, then property order, then state order
// ---------------------------------------------------------------------------

const EMPHASIS_ORDER = ["filled", "outlined", "ghost"];
const ROLE_ORDER = ["accent", "action", "danger", "agent", "data", "success", "caution"];
const PROPERTY_ORDER = ["bg", "fg", "border", "icon"];
const STATE_ORDER = ["rest", "hover", "active"];

// ---------------------------------------------------------------------------
// Generate tokens from the Brio (default) recipe
// ---------------------------------------------------------------------------

const output = deriveTheme(EXAMPLE_RECIPES.brio);

// Control tokens: --tug-base-control-{emphasis}-{role}-*
// We extract all emphasis×role tokens (filled, outlined, ghost) but NOT
// disabled, selected, highlighted, or surface-control (those are separate).
const EMPHASIS_ROLE_PATTERN =
  /^--tug-base-control-(filled|outlined|ghost)-(accent|action|agent|data|danger|success|caution)-/;

const controlEntries = Object.entries(output.tokens)
  .filter(([name]) => EMPHASIS_ROLE_PATTERN.test(name))
  .sort(controlTokenSort);

function controlTokenSort([a]: [string, string], [b]: [string, string]): number {
  const pa = parseControlToken(a);
  const pb = parseControlToken(b);
  if (!pa || !pb) return a.localeCompare(b);

  // Primary: emphasis
  const ei = EMPHASIS_ORDER.indexOf(pa.emphasis) - EMPHASIS_ORDER.indexOf(pb.emphasis);
  if (ei !== 0) return ei;

  // Secondary: role
  const ri = ROLE_ORDER.indexOf(pa.role) - ROLE_ORDER.indexOf(pb.role);
  if (ri !== 0) return ri;

  // Tertiary: property
  const pi = PROPERTY_ORDER.indexOf(pa.property) - PROPERTY_ORDER.indexOf(pb.property);
  if (pi !== 0) return pi;

  // Quaternary: state
  return STATE_ORDER.indexOf(pa.state) - STATE_ORDER.indexOf(pb.state);
}

function parseControlToken(name: string): {
  emphasis: string;
  role: string;
  property: string;
  state: string;
} | null {
  const m = name.match(
    /^--tug-base-control-(filled|outlined|ghost)-(accent|action|agent|data|danger|success|caution)-(bg|fg|border|icon)-(rest|hover|active)$/,
  );
  if (!m) return null;
  return { emphasis: m[1], role: m[2], property: m[3], state: m[4] };
}

// ---------------------------------------------------------------------------
// Build CSS lines
// ---------------------------------------------------------------------------

const lines: string[] = [];

lines.push(
  `  /* @generated:control-tokens:begin — do not edit. Source: theme-derivation-engine.ts */`,
);
lines.push(
  `  /* Regenerate: bun run generate:control-tokens                                      */`,
);

let lastGroup = "";

for (const [name, value] of controlEntries) {
  const parsed = parseControlToken(name);
  if (!parsed) continue;

  const group = `${parsed.emphasis}-${parsed.role}`;
  if (group !== lastGroup) {
    lines.push(``);
    // Section comment
    const label = `${capitalize(parsed.emphasis)} ${capitalize(parsed.role)}`;
    lines.push(`  /* ${label} */`);
    lastGroup = group;
  }

  lines.push(`  ${name}: ${value};`);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Splice into tug-base.css
// ---------------------------------------------------------------------------

const tugdeckDir = path.resolve(import.meta.dir, "..");
const cssPath = path.join(tugdeckDir, "styles", "tug-base.css");
const css = await Bun.file(cssPath).text();

const BEGIN_MARKER = "/* @generated:control-tokens:begin";
const END_MARKER = "/* @generated:control-tokens:end */";

const beginIdx = css.indexOf(BEGIN_MARKER);
const endIdx = css.indexOf(END_MARKER);

if (beginIdx === -1 || endIdx === -1) {
  console.error(
    `[generate-tug-control-tokens] ERROR: marker comments not found in ${cssPath}`,
  );
  console.error(`  Expected: ${BEGIN_MARKER}`);
  console.error(`  Expected: ${END_MARKER}`);
  process.exit(1);
}

// Find the start of the line containing BEGIN_MARKER
const lineStart = css.lastIndexOf("\n", beginIdx) + 1;

const before = css.slice(0, lineStart);
const after = css.slice(endIdx);

const generated = lines.join("\n") + "\n  ";

await Bun.write(cssPath, before + generated + after);

const tokenCount = controlEntries.length;
console.log(
  `[generate-tug-control-tokens] wrote ${tokenCount} control tokens to ${cssPath}`,
);
