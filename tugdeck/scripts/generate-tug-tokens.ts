#!/usr/bin/env bun
/**
 * generate-tug-tokens.ts
 *
 * Generates ALL --tug-base-* tokens in styles/tug-base-generated.css from the
 * theme derivation engine. The engine (deriveTheme) is the single source
 * of truth; this script keeps tug-base-generated.css in sync.
 *
 * tug-base-generated.css is imported by tug-base.css via @import. It contains
 * bare custom property declarations (2-space indent) that land inside the
 * body {} context of tug-base.css.
 *
 * Usage:
 *   bun run scripts/generate-tug-tokens.ts
 *
 * Or via package.json:
 *   bun run generate:tokens
 *   bun run generate:control-tokens  (alias for backward compat)
 */

import path from "path";
import {
  deriveTheme,
  EXAMPLE_RECIPES,
} from "../src/components/tugways/theme-derivation-engine";

// ---------------------------------------------------------------------------
// Generate tokens from the Brio (default) recipe
// ---------------------------------------------------------------------------

const output = deriveTheme(EXAMPLE_RECIPES.brio);
const allTokens = output.tokens;

// ---------------------------------------------------------------------------
// Token grouping — ordered by prefix per spec
// ---------------------------------------------------------------------------

const EMPHASIS_ORDER = ["filled", "outlined", "ghost"];
const ROLE_ORDER = ["accent", "action", "option", "danger", "agent", "data", "success", "caution"];
const PROPERTY_ORDER = ["bg", "fg", "border", "icon"];
const STATE_ORDER = ["rest", "hover", "active"];

const EMPHASIS_ROLE_PATTERN =
  /^--tug-base-control-(filled|outlined|ghost)-(accent|action|option|agent|data|danger|success|caution)-/;

function parseControlToken(name: string): {
  emphasis: string;
  role: string;
  property: string;
  state: string;
} | null {
  const m = name.match(
    /^--tug-base-control-(filled|outlined|ghost)-(accent|action|option|agent|data|danger|success|caution)-(bg|fg|border|icon)-(rest|hover|active)$/,
  );
  if (!m) return null;
  return { emphasis: m[1], role: m[2], property: m[3], state: m[4] };
}

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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Build groups of tokens by prefix
// ---------------------------------------------------------------------------

type TokenEntry = [string, string];

function getGroup(name: string): string {
  const rest = name.replace("--tug-base-", "");
  if (rest.startsWith("motion-")) return "motion";
  if (rest.startsWith("space-")) return "space";
  if (rest.startsWith("radius-")) return "radius";
  if (rest.startsWith("chrome-")) return "chrome";
  if (rest.startsWith("icon-size-")) return "icon-size";
  if (rest.startsWith("font-") || rest.startsWith("line-height-")) return "font";
  if (rest.startsWith("bg-")) return "bg";
  if (rest.startsWith("surface-") && !rest.startsWith("surface-control")) return "surface";
  if (rest.startsWith("fg-")) return "fg";
  if (rest.startsWith("icon-")) return "icon";
  if (rest.startsWith("border-")) return "border";
  if (rest.startsWith("divider-")) return "divider";
  if (rest.startsWith("shadow-") || rest.startsWith("overlay-")) return "overlay";
  if (rest.startsWith("accent-")) return "accent";
  if (rest.startsWith("tone-")) return "tone";
  if (rest.startsWith("selection-")) return "selection";
  if (rest.startsWith("highlight-")) return "highlight";
  if (rest.startsWith("tab-")) return "tab";
  if (rest.startsWith("control-disabled-")) return "control-disabled";
  if (EMPHASIS_ROLE_PATTERN.test(name)) return "control-emphasis-role";
  if (
    rest.startsWith("control-surface") ||
    rest.startsWith("control-selected") ||
    rest.startsWith("control-highlighted") ||
    rest === "surface-control"
  ) return "control-surface";
  if (rest.startsWith("field-")) return "field";
  if (
    rest.startsWith("toggle-") ||
    rest.startsWith("checkmark") ||
    rest.startsWith("radio-")
  ) return "toggle";
  if (rest.startsWith("separator")) return "separator";
  return "other";
}

const GROUP_ORDER = [
  "motion",
  "space",
  "radius",
  "chrome",
  "icon-size",
  "font",
  "bg",
  "surface",
  "fg",
  "icon",
  "border",
  "divider",
  "overlay",
  "accent",
  "tone",
  "selection",
  "highlight",
  "tab",
  "control-disabled",
  "control-emphasis-role",
  "control-surface",
  "field",
  "toggle",
  "separator",
  "other",
];

const GROUP_LABELS: Record<string, string> = {
  motion: "Motion",
  space: "Space",
  radius: "Radius",
  chrome: "Chrome",
  "icon-size": "Icon Size",
  font: "Font",
  bg: "Background",
  surface: "Surface",
  fg: "Foreground",
  icon: "Icon",
  border: "Border",
  divider: "Divider",
  overlay: "Overlay",
  accent: "Accent",
  tone: "Tone",
  selection: "Selection",
  highlight: "Highlight",
  tab: "Tab",
  "control-disabled": "Control \u2014 Disabled",
  "control-emphasis-role": "Control \u2014 Emphasis\u00d7Role",
  "control-surface": "Control \u2014 Surface / Selected / Highlighted",
  field: "Field",
  toggle: "Toggle",
  separator: "Separator",
  other: "Other",
};

// Collect all tokens into groups
const groups: Record<string, TokenEntry[]> = {};
for (const group of GROUP_ORDER) {
  groups[group] = [];
}

for (const entry of Object.entries(allTokens)) {
  const group = getGroup(entry[0]);
  if (!groups[group]) groups[group] = [];
  groups[group].push(entry);
}

// Sort within each group
for (const group of GROUP_ORDER) {
  if (group === "control-emphasis-role") {
    groups[group].sort(controlTokenSort);
  } else {
    groups[group].sort(([a], [b]) => a.localeCompare(b));
  }
}

// ---------------------------------------------------------------------------
// Build CSS lines
// ---------------------------------------------------------------------------

const lines: string[] = [];

lines.push(`/* Generated by generate-tug-tokens.ts \u2014 do not edit. */`);
lines.push(`/* Regenerate: bun run generate:tokens                  */`);
lines.push(`body {`);

let isFirstGroup = true;

for (const group of GROUP_ORDER) {
  const entries = groups[group];
  if (entries.length === 0) continue;

  // Add blank line between sections
  if (!isFirstGroup) {
    lines.push(``);
  }
  isFirstGroup = false;

  const label = GROUP_LABELS[group] ?? group;

  if (group === "control-emphasis-role") {
    // For the emphasis×role group, emit per-combination sub-headers
    lines.push(`  /* ${label} */`);
    let lastCombo = "";
    for (const [name, value] of entries) {
      const parsed = parseControlToken(name);
      if (parsed) {
        const combo = `${parsed.emphasis}-${parsed.role}`;
        if (combo !== lastCombo) {
          lines.push(``);
          lines.push(`  /* ${capitalize(parsed.emphasis)} ${capitalize(parsed.role)} */`);
          lastCombo = combo;
        }
      }
      lines.push(`  ${name}: ${value};`);
    }
  } else {
    lines.push(`  /* ${label} */`);
    for (const [name, value] of entries) {
      lines.push(`  ${name}: ${value};`);
    }
  }
}

lines.push(`}`);

// ---------------------------------------------------------------------------
// Write tug-base-generated.css wholesale
// ---------------------------------------------------------------------------

const tugdeckDir = path.resolve(import.meta.dir, "..");
const generatedCssPath = path.join(tugdeckDir, "styles", "tug-base-generated.css");

await Bun.write(generatedCssPath, lines.join("\n") + "\n");

const tokenCount = Object.keys(allTokens).length;
console.log(
  `[generate-tug-tokens] wrote ${tokenCount} tokens to ${generatedCssPath}`,
);
