#!/usr/bin/env bun
/**
 * generate-tug-tokens.ts
 *
 * Generates ALL --tug-* tokens for every built-in theme recipe.
 *
 * Brio (default dark):
 *   styles/tug-base-generated.css — imported by tug-base.css via @import.
 *   Contains bare custom property declarations (2-space indent) inside
 *   the body {} context of tug-base.css.
 *
 * Non-default themes (e.g. harmony):
 *   styles/themes/<name>.css — standalone override files. Each file wraps
 *   all 373 tokens in a body {} block. When injected as a <style> element
 *   after tug-base.css, the cascade overrides all brio defaults. [D01]
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
  type ThemeRecipe,
} from "../src/components/tugways/theme-engine";
import brioJson from "../themes/brio.json";
import harmonyJson from "../themes/harmony.json";

// ---------------------------------------------------------------------------
// Token grouping — ordered by prefix per six-slot convention
// <plane>-<component>-<constituent>-<emphasis>-<role>-<state>
// ---------------------------------------------------------------------------

const EMPHASIS_ORDER = ["filled", "outlined", "ghost"];
const ROLE_ORDER = ["accent", "action", "option", "danger", "agent", "data", "success", "caution"];
const CONSTITUENT_ORDER = ["primary", "text", "icon", "border", "shadow"];
const STATE_ORDER = ["rest", "hover", "active"];
// Plane order: surface bg tokens before element fg/border/icon tokens
const PLANE_ORDER = ["surface", "element"];

// Matches control tokens with emphasis (filled|outlined|ghost) in the new six-slot format:
// --tug-(element|surface)-control-<constituent>-(filled|outlined|ghost)-<role>-<state>
const EMPHASIS_ROLE_PATTERN =
  /^--tug-(element|surface)-control-\w+-(filled|outlined|ghost)-(accent|action|option|agent|data|danger|success|caution)-/;

function parseControlToken(name: string): {
  plane: string;
  constituent: string;
  emphasis: string;
  role: string;
  state: string;
} | null {
  const m = name.match(
    /^--tug-(element|surface)-control-(\w+)-(filled|outlined|ghost)-(accent|action|option|agent|data|danger|success|caution)-(rest|hover|active)$/,
  );
  if (!m) return null;
  return { plane: m[1], constituent: m[2], emphasis: m[3], role: m[4], state: m[5] };
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

  // Tertiary: plane (surface before element)
  const pli = PLANE_ORDER.indexOf(pa.plane) - PLANE_ORDER.indexOf(pb.plane);
  if (pli !== 0) return pli;

  // Quaternary: constituent
  const ci = CONSTITUENT_ORDER.indexOf(pa.constituent) - CONSTITUENT_ORDER.indexOf(pb.constituent);
  if (ci !== 0) return ci;

  // Quinary: state
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
  const rest = name.replace("--tug-", "");

  // Non-color structural tokens — unaffected by the rename
  if (rest.startsWith("motion-")) return "motion";
  if (rest.startsWith("space-")) return "space";
  if (rest.startsWith("radius-")) return "radius";
  if (rest.startsWith("chrome-")) return "chrome";
  if (rest.startsWith("icon-size-")) return "icon-size";
  if (rest.startsWith("font-") || rest.startsWith("line-height-")) return "font";

  // Legacy non-color structural token with identity mapping (not renamed)
  if (rest.startsWith("control-disabled-")) return "control-disabled";

  // Six-slot tokens: route by plane + component (slots 1-2 after stripping --tug-)
  // element-global-* sub-routing by constituent (slot 3)
  if (rest.startsWith("element-global-text-")) return "fg";
  if (rest.startsWith("element-global-icon-")) return "icon";
  if (rest.startsWith("element-global-border-")) return "border";
  if (rest.startsWith("element-global-divider-")) return "divider";
  if (rest.startsWith("element-global-shadow-")) return "shadow";
  if (rest.startsWith("element-global-fill-")) return "accent";

  // element-tone-* and surface-tone-* -> tone group
  if (rest.startsWith("element-tone-") || rest.startsWith("surface-tone-")) return "tone";

  // Control tokens: emphasis-role variants (filled|outlined|ghost) go to the sortable group
  if (EMPHASIS_ROLE_PATTERN.test(name)) return "control-emphasis-role";
  // Control tokens: normal emphasis (selected, highlighted, disabled) go to control-surface group
  if (rest.startsWith("element-control-") || rest.startsWith("surface-control-")) return "control-surface";

  // surface-global-* -> surface (background) group
  if (rest.startsWith("surface-global-")) return "surface";

  // element-field-* and surface-field-* -> field group
  if (rest.startsWith("element-field-") || rest.startsWith("surface-field-")) return "field";

  // element-tab-*, element-tabClose-*, surface-tab-*, surface-tabClose-* -> tab group
  if (
    rest.startsWith("element-tab-") ||
    rest.startsWith("element-tabClose-") ||
    rest.startsWith("surface-tab-") ||
    rest.startsWith("surface-tabClose-")
  ) return "tab";

  // element-toggle-*, element-checkmark-*, element-radio-*, surface-toggle-* -> toggle group
  if (
    rest.startsWith("element-toggle-") ||
    rest.startsWith("element-checkmark-") ||
    rest.startsWith("element-radio-") ||
    rest.startsWith("surface-toggle-")
  ) return "toggle";

  // element-selection-* and surface-selection-* -> selection group
  if (rest.startsWith("element-selection-") || rest.startsWith("surface-selection-")) return "selection";

  // surface-highlight-* -> highlight group
  if (rest.startsWith("surface-highlight-")) return "highlight";

  // surface-overlay-* -> overlay group
  if (rest.startsWith("surface-overlay-")) return "overlay";

  // element-badge-* and surface-badge-* -> badge group
  if (rest.startsWith("element-badge-") || rest.startsWith("surface-badge-")) return "badge";

  return "other";
}

const GROUP_ORDER = [
  "motion",
  "space",
  "radius",
  "chrome",
  "icon-size",
  "font",
  "surface",
  "fg",
  "icon",
  "border",
  "divider",
  "shadow",
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
  "badge",
  "other",
];

const GROUP_LABELS: Record<string, string> = {
  motion: "Motion",
  space: "Space",
  radius: "Radius",
  chrome: "Chrome",
  "icon-size": "Icon Size",
  font: "Font",
  surface: "Surface \u2014 Global",
  fg: "Element \u2014 Text",
  icon: "Element \u2014 Icon",
  border: "Element \u2014 Border",
  divider: "Element \u2014 Divider",
  shadow: "Element \u2014 Shadow",
  overlay: "Surface \u2014 Overlay",
  accent: "Element \u2014 Fill (Accent)",
  tone: "Tone",
  selection: "Selection",
  highlight: "Surface \u2014 Highlight",
  tab: "Tab",
  "control-disabled": "Control \u2014 Disabled",
  "control-emphasis-role": "Control \u2014 Emphasis\u00d7Role",
  "control-surface": "Control \u2014 Surface / Selected / Highlighted",
  field: "Field",
  toggle: "Toggle",
  badge: "Badge",
  other: "Other",
};

// ---------------------------------------------------------------------------
// buildTokenCssLines — shared formatting for both brio and theme overrides
//
// Returns an array of CSS lines (without a trailing newline).
// For brio's generated file the caller wraps the token lines inside the
// existing body {} block in tug-base-generated.css; for standalone theme
// override files the caller wraps everything in its own body {} block.
// ---------------------------------------------------------------------------

function buildTokenCssLines(tokens: Record<string, string>): string[] {
  // Collect all tokens into groups
  const groups: Record<string, TokenEntry[]> = {};
  for (const group of GROUP_ORDER) {
    groups[group] = [];
  }

  for (const entry of Object.entries(tokens)) {
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

  const lines: string[] = [];
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

  return lines;
}

// ---------------------------------------------------------------------------
// Generate and write brio tokens to styles/tug-base-generated.css
// ---------------------------------------------------------------------------

const tugdeckDir = path.resolve(import.meta.dir, "..");

const brio = brioJson as ThemeRecipe;
const harmony = harmonyJson as ThemeRecipe;

const brioOutput = deriveTheme(brio);
const brioTokens = brioOutput.tokens;
const brioTokenCount = Object.keys(brioTokens).length;

const brioLines: string[] = [];
brioLines.push(`/* Generated by generate-tug-tokens.ts \u2014 do not edit. */`);
brioLines.push(`/* Regenerate: bun run generate:tokens                  */`);
brioLines.push(`body {`);
brioLines.push(...buildTokenCssLines(brioTokens));
brioLines.push(`}`);

const generatedCssPath = path.join(tugdeckDir, "styles", "tug-base-generated.css");
await Bun.write(generatedCssPath, brioLines.join("\n") + "\n");
console.log(
  `[generate-tug-tokens] wrote ${brioTokenCount} tokens to ${generatedCssPath}`,
);

// ---------------------------------------------------------------------------
// Generate standalone override CSS for each non-brio shipped theme.
// [D01] Each file is a complete 373-token body {} override — injecting it after
// tug-base.css overrides all brio defaults via the CSS cascade.
// ---------------------------------------------------------------------------

const themesDir = path.join(tugdeckDir, "styles", "themes");

for (const recipe of [harmony] as ThemeRecipe[]) {
  const themeOutput = deriveTheme(recipe);
  const themeTokens = themeOutput.tokens;
  const themeTokenCount = Object.keys(themeTokens).length;

  const themeLines: string[] = [];
  themeLines.push(`/* Generated by generate-tug-tokens.ts \u2014 do not edit. */`);
  themeLines.push(`/* Regenerate: bun run generate:tokens                  */`);
  themeLines.push(`body {`);
  themeLines.push(...buildTokenCssLines(themeTokens));
  themeLines.push(`}`);

  const themeCssPath = path.join(themesDir, `${recipe.name}.css`);
  await Bun.write(themeCssPath, themeLines.join("\n") + "\n");
  console.log(
    `[generate-tug-tokens] wrote ${themeTokenCount} tokens to ${themeCssPath}`,
  );
}
